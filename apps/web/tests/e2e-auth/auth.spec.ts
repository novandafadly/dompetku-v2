import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { addMonths, todayWIB } from '@dompetku/domain';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';
import { MAIL_FILE } from '../../playwright.auth.config';
import { expectNoSeriousViolations, WCAG_TAGS } from '../e2e/axe';
import { routeScripts } from '../e2e/route-scripts';
import { OWNER } from './global-setup';

/**
 * Alur auth sungguhan ujung ke ujung (AFD §1, §2, §6): pemilik daftar lewat allowlist,
 * konfirmasi email, amankan dengan passkey (autentikator virtual), undang pasangan; pasangan
 * amankan dengan TOTP; masuk lagi, kode salah, jeda, kode pemulihan, lupa kata sandi.
 * Satu urutan serial karena tiap langkah memakai keadaan langkah sebelumnya.
 */

const PARTNER = 'farida@example.test';
const PASSWORD = 'kuda-lari-di-sawah-42';
const NEW_PASSWORD = 'perahu-kertas-di-kali-77';

test.describe.configure({ mode: 'serial' });

async function lastMail(subject: RegExp): Promise<{ to: string; text: string }> {
  const lines = (await readFile(MAIL_FILE, 'utf8')).trim().split('\n');
  const mails = lines.map((l) => JSON.parse(l) as { to: string; subject: string; text: string });
  const mail = mails.reverse().find((m) => subject.test(m.subject));
  if (!mail) throw new Error(`email ${String(subject)} tidak ada`);
  return mail;
}

function linkIn(text: string): string {
  const m = /(http:\/\/localhost:\d+\/\S+)/.exec(text);
  if (!m?.[1]) throw new Error('email tanpa tautan');
  return new URL(m[1]).pathname + new URL(m[1]).search;
}

function totp(secretBase32: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.replace(/\s|=/g, '').toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < key.length; i++) key[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 0xf;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

async function addPasskeyAuthenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  // Sesudah ubah ukuran, tata letak HP/laptop dipilih ulang di klien (useMedia): tunggu stabil.
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
}

async function checkScreen(page: Page): Promise<void> {
  await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
  await page.setViewportSize({ width: 320, height: 720 });
  await noHorizontalScroll(page);
  await page.setViewportSize({ width: 1280, height: 720 });
}

let owner: BrowserContext;
let ownerPage: Page;
let partnerPage: Page;
let ownerCodes: string[] = [];
let partnerSecret = '';

test.beforeAll(async ({ browser }) => {
  owner = await browser.newContext();
  ownerPage = await owner.newPage();
  partnerPage = await (await browser.newContext()).newPage();
});

test('halaman data tanpa sesi dialihkan ke /masuk', async () => {
  await ownerPage.goto('/pribadi/beranda');
  await expect(ownerPage).toHaveURL(/\/masuk$/);
  await expect(ownerPage.getByText('Prototipe: belum aktif')).toHaveCount(0);
  await checkScreen(ownerPage);
  // Tema terang (Menu → Tampilan) juga lolos axe di layar auth.
  for (const path of ['/masuk?theme=light', '/buat-akun?theme=light', '/lupa-sandi?theme=light']) {
    await ownerPage.goto(path);
    await expect(ownerPage.locator('html')).toHaveAttribute('data-theme', 'light');
    await expectNoSeriousViolations(ownerPage, { tags: WCAG_TAGS });
  }
});

test('JS muat dingin rute auth ≤ 162 kB', async ({ browser }) => {
  for (const path of ['/masuk', '/buat-akun', '/lupa-sandi']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const response = await page.goto(path);
    if (!response) throw new Error('tanpa respons');
    const own = routeScripts(await response.text());
    await page.waitForLoadState('networkidle');
    const bytes = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((e): e is PerformanceResourceTiming => e instanceof PerformanceResourceTiming)
        .filter((e) => new URL(e.name).pathname.endsWith('.js'))
        .map((e) => ({ path: new URL(e.name).pathname, bytes: e.encodedBodySize })),
    );
    await context.close();
    const kB = bytes.filter((s) => own.has(s.path)).reduce((a, s) => a + s.bytes, 0) / 1024;
    test.info().annotations.push({ type: `js-route-kB ${path}`, description: kB.toFixed(1) });
    expect(kB).toBeLessThanOrEqual(162);
  }
});

test('pemilik: daftar lewat allowlist, respons seragam untuk email lain', async () => {
  const page = ownerPage;
  await page.goto('/buat-akun');
  await checkScreen(page);
  await page.getByLabel('Email').fill('orang@example.test');
  await page.getByLabel('Nama panggilan').fill('Orang');
  await page.getByLabel('Kata sandi baru').fill(PASSWORD);
  await page.getByRole('button', { name: 'Buat akun' }).click();
  await expect(page.getByRole('heading', { name: 'Periksa email' })).toBeVisible();

  await page.goto('/buat-akun');
  await page.getByLabel('Email').fill(OWNER);
  await page.getByLabel('Nama panggilan').fill('Novanda');
  await page.getByLabel('Kata sandi baru').fill('pendek');
  await page.getByRole('button', { name: 'Buat akun' }).click();
  await expect(page.getByText('Kata sandi minimal 12 karakter.')).toBeVisible();
  await page.getByLabel('Kata sandi baru').fill(PASSWORD);
  await page.getByRole('button', { name: 'Buat akun' }).click();
  await expect(page.getByRole('heading', { name: 'Periksa email' })).toBeVisible();

  const mail = await lastMail(/Konfirmasi email/);
  expect(mail.to).toBe(OWNER);
  await page.goto(linkIn(mail.text));
  await checkScreen(page);
  await page.getByRole('button', { name: 'Konfirmasi email' }).click();
  await expect(page.getByText('Email terkonfirmasi.')).toBeVisible();
});

test('pemilik: masuk, amankan dengan passkey, kode pemulihan, Beranda', async () => {
  const page = ownerPage;
  await page.getByLabel('Email').fill(OWNER);
  await page.getByLabel('Kata sandi', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page).toHaveURL(/\/amankan$/);
  await expect(page.getByRole('heading', { name: 'Amankan akunmu' })).toBeVisible();
  await checkScreen(page);

  // Halaman data ditolak selama sesi belum punya faktor kuat.
  await page.goto('/pribadi/beranda');
  await expect(page).toHaveURL(/\/amankan$/);

  await addPasskeyAuthenticator(page);
  await page.getByRole('button', { name: 'Buat passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Simpan kode pemulihan' })).toBeVisible();
  await page.getByRole('button', { name: 'Buat kode pemulihan' }).click();
  const codes = page.getByRole('list', { name: 'Kode pemulihan' }).getByRole('listitem');
  await expect(codes).toHaveCount(10);
  ownerCodes = await codes.allInnerTexts();
  await checkScreen(page);
  await expect(page.getByRole('button', { name: 'Selesai' })).toBeDisabled();
  await page.getByLabel('Saya sudah menyimpan kode ini di tempat yang aman.').check();
  await page.getByRole('button', { name: 'Selesai' }).click();
  await expect(page).toHaveURL(/\/pribadi\/beranda$/);
});

/** User dan ruang (`personal`/`shared`) milik email ini (superuser, hanya untuk menyiapkan data). */
async function spaceOf(
  email: string,
  kind: 'personal' | 'shared',
): Promise<{ uid: string; sid: string }> {
  const admin = new pg.Client({ connectionString: process.env.AUTH_E2E_ADMIN_URL });
  try {
    await admin.connect();
    const { rows } = await admin.query<{ uid: string; sid: string }>(
      `select u.id as uid, s.id as sid from auth."user" u
         join app.space_members m on m.user_id = u.id
         join app.spaces s on s.id = m.space_id and s.kind = $2::app.space_kind
        where u.email = $1`,
      [email, kind],
    );
    const row = rows[0];
    if (!row) throw new Error('ruang tidak ada');
    return row;
  } finally {
    await admin.end();
  }
}

/** Satu kueri sebagai dompetku_web dengan konteks user (seperti action ledger). */
async function asUser<T extends pg.QueryResultRow>(
  uid: string,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const web = new pg.Client({ connectionString: process.env.AUTH_E2E_DATABASE_URL });
  try {
    await web.connect();
    await web.query('begin');
    await web.query("select set_config('app.user_id', $1, true)", [uid]);
    const { rows } = await web.query<T>(sql, params);
    await web.query('commit');
    return rows;
  } finally {
    await web.end();
  }
}

/** Dompet operasional lewat `api.create_account` sebagai dompetku_web (seperti action Dompet). */
async function createWallet(
  email: string,
  kind: 'personal' | 'shared',
  name: string,
  opening: number,
) {
  const { uid, sid } = await spaceOf(email, kind);
  await asUser(
    uid,
    `select api.create_account(p_client_id => $1, p_space_id => $2, p_name => $3,
       p_pocket => 'operasional', p_wallet_type => 'bank', p_opening_balance => $4::bigint)`,
    [randomUUID(), sid, name, opening],
  );
}

/** Pengeluaran hari ini di dompet bernama `wallet` lewat `api.create_entry` (seperti action Catat). */
async function createExpense(
  email: string,
  kind: 'personal' | 'shared',
  wallet: string,
  amount: number,
  description: string,
) {
  const { uid, sid } = await spaceOf(email, kind);
  const [ids] = await asUser<{ account: string; category: string }>(
    uid,
    `select (select id from app.accounts where space_id = $1 and name = $2) as account,
            (select id from app.categories
              where space_id = $1 and type = 'expense' and parent_id is null
              order by sort_order limit 1) as category`,
    [sid, wallet],
  );
  if (!ids?.account || !ids.category) throw new Error('dompet/kategori tidak ada');
  await asUser(
    uid,
    `select api.create_entry(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_kind => 'expense', p_amount => $4::bigint, p_category_id => $5, p_description => $6)`,
    [randomUUID(), sid, ids.account, amount, ids.category, description],
  );
}

/** Tangkapan tinjauan desain (SCREENS_REAL=1): 320/390/1280, terang dan gelap. */
async function berandaShots(page: Page, path: string, name: string): Promise<void> {
  if (!process.env.SCREENS_REAL) return;
  for (const theme of ['dark', 'light']) {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${path}?theme=${theme}`);
      await expect(page.getByTestId('balance-card')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `test-results/screens-real/${name}-${theme}-${String(width)}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

/** Tangkapan tinjauan desain Transaksi nyata (SCREENS_REAL=1), menunggu teks `ready`. */
async function transaksiShots(page: Page, path: string, name: string, ready: string) {
  if (!process.env.SCREENS_REAL) return;
  for (const theme of ['dark', 'light']) {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${path}${path.includes('?') ? '&' : '?'}theme=${theme}`);
      await expect(page.getByText(ready).first()).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `test-results/screens-real/${name}-${theme}-${String(width)}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

const PRIBADI_WALLET = 'KANARI-DOMPET-PRIBADI-E2E';

test('pemilik: Beranda nyata tanpa dompet: tanpa data demo, no-store, checklist, Catat nyata', async () => {
  const page = ownerPage;
  const res = await page.goto('/pribadi/beranda');
  expect(res?.headers()['cache-control'] ?? '').toContain('no-store');
  await expect(
    page.getByRole('heading', { name: 'Aman dipakai sampai', exact: false }),
  ).toBeVisible();
  await expect(page.getByText('Data demo')).toHaveCount(0);
  await expect(page.getByText('Tambahkan dompet operasional')).toBeVisible();
  const steps = page.getByRole('list', { name: 'Mulai dari sini' });
  await expect(steps.getByText('Akun aman')).toBeVisible();
  // Pemilik, Bersama belum berisi dua orang.
  await expect(steps.getByRole('link', { name: /Undang Farida/ })).toBeVisible();
  // Tanpa dompet operasional: S6-B1 tidak tampil.
  await expect(page.getByRole('button', { name: 'Tidak ada pengeluaran hari ini' })).toHaveCount(0);
  await checkScreen(page);
  await berandaShots(page, '/pribadi/beranda', 'beranda-kosong');

  // Sheet Catat nyata (bukan demo): ruang tanpa dompet = S6-C6.
  await page.locator('[data-catat-trigger]:visible').click();
  await expect(
    page.getByText('Belum ada dompet di Pribadi. Tambah dompet dulu untuk mencatat.'),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  // Transaksi nyata, kosong pertama kali: salinan tetap + Catat membuka sheet Catat nyata.
  await page.goto('/pribadi/transaksi');
  await expect(page.getByText('Belum ada transaksi di Pribadi.')).toBeVisible();
  await expect(page.getByText('Data demo')).toHaveCount(0);
  await checkScreen(page);
  await transaksiShots(page, '/pribadi/transaksi', 'transaksi-kosong', 'Belum ada transaksi');
  await page.getByRole('main').getByRole('button', { name: 'Catat' }).click();
  await expect(
    page.getByText('Belum ada dompet di Pribadi. Tambah dompet dulu untuk mencatat.'),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  // Rencana belum ada di mode nyata: 404.
  // Status stream sudah 200 saat page melempar notFound (Suspense root); isinya halaman 404.
  await page.goto('/pribadi/rencana');
  await expect(page.getByText('This page could not be found.')).toBeVisible();
});

test('pemilik: Beranda nyata dengan dompet: kartu, tidak ada pengeluaran hari ini', async () => {
  const page = ownerPage;
  await createWallet(OWNER, 'personal', PRIBADI_WALLET, 1_250_000);
  await createWallet(OWNER, 'shared', 'Kas Rumah', 400_000);
  await page.goto('/pribadi/beranda');
  const card = page.getByTestId('balance-card');
  await expect(card.getByTestId('hero-amount')).toContainText('1.250.000');
  // Mode nyata S6: tanpa baris tagihan dan anggaran.
  await expect(card.getByText(/Tagihan s\.d\./)).toHaveCount(0);
  await expect(page.getByText(PRIBADI_WALLET)).toBeVisible();
  await checkScreen(page);
  await berandaShots(page, '/pribadi/beranda', 'beranda-dompet');

  const mark = page.getByRole('button', { name: 'Tidak ada pengeluaran hari ini' });
  await mark.click();
  const status = page
    .getByRole('status')
    .filter({ hasText: 'Hari ini tercatat tanpa pengeluaran.' });
  await expect(status).toBeVisible();
  await expect(status).toBeFocused();
  await page.reload();
  await expect(page.getByText('Hari ini tercatat tanpa pengeluaran.')).toBeVisible();
  await expect(mark).toHaveCount(0);
  await berandaShots(page, '/pribadi/beranda', 'beranda-ditandai');

  // Rute Bersama (HTML + payload RSC) tanpa data Pribadi.
  const html = await (await page.request.get('/bersama/beranda')).text();
  const rsc = await (await page.request.get('/bersama/beranda', { headers: { RSC: '1' } })).text();
  expect(html).toContain('Kas Rumah');
  expect(html + rsc).not.toContain(PRIBADI_WALLET);
  await page.goto('/bersama/beranda');
  // Undang Farida hanya di Pribadi.
  await expect(page.getByRole('link', { name: /Undang Farida/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tidak ada pengeluaran hari ini' })).toBeVisible();
  await checkScreen(page);
  await berandaShots(page, '/bersama/beranda', 'beranda-bersama');
});

const PRIBADI_KANARI = 'KANARI-TRANSAKSI-PRIBADI-E2E';

test('pemilik: Transaksi nyata: entri dan ringkasan Pribadi, tidak terbawa ke Bersama', async () => {
  const page = ownerPage;
  await createExpense(OWNER, 'personal', PRIBADI_WALLET, 37_500, PRIBADI_KANARI);
  const res = await page.goto('/pribadi/transaksi');
  expect(res?.headers()['cache-control'] ?? '').toContain('no-store');
  const main = page.getByRole('main');
  const today = main.getByRole('region', { name: /^Hari ini/ });
  const row = today.getByRole('listitem').filter({ hasText: PRIBADI_KANARI });
  await expect(row).toContainText(PRIBADI_WALLET);
  await expect(row).toContainText('37.500');
  // Saldo awal dompet juga entri hari ini.
  await expect(today.getByRole('listitem').filter({ hasText: 'Saldo awal' })).toHaveCount(1);
  // Laptop: ringkasan bulan di kolom kanan, dari api.month_summary.
  const summary = page.getByRole('complementary', { name: 'Ringkasan bulan' });
  await expect(summary.getByRole('row', { name: /Pengeluaran/ })).toContainText('37.500');
  await expect(summary.getByText(/Tidak termasuk: Transfer internal/)).toBeVisible();
  await expect(main.getByRole('link', { name: 'Sampah' })).toHaveAttribute(
    'href',
    '/pribadi/sampah',
  );
  await expect(page.getByText('Data demo')).toHaveCount(0);
  await checkScreen(page);
  await transaksiShots(page, '/pribadi/transaksi', 'transaksi-daftar', PRIBADI_KANARI);

  // Bulan tidak sah: bulan berjalan, bukan 404/500. Bulan lalu: kosong karena bulan.
  const bad = await page.goto('/pribadi/transaksi?bulan=2026-13');
  expect(bad?.status()).toBe(200);
  await expect(main.getByText(PRIBADI_KANARI)).toBeVisible();
  // Dompet pertama dibuka bulan ini: tidak ada bulan sebelumnya yang bisa dituju.
  await expect(main.getByRole('button', { name: 'Bulan sebelumnya' })).toBeDisabled();
  await expect(main.getByRole('button', { name: 'Bulan berikutnya' })).toBeDisabled();
  const prev = addMonths(todayWIB().slice(0, 7), -1);
  await page.goto(`/pribadi/transaksi?bulan=${prev}`);
  await expect(main.getByText(/^Belum ada transaksi di \p{L}+\.$/u)).toBeVisible();
  await expect(main.getByRole('button', { name: 'Catat' })).toHaveCount(0);
  await checkScreen(page);
  await transaksiShots(
    page,
    `/pribadi/transaksi?bulan=${prev}`,
    'transaksi-bulan-kosong',
    'Belum ada transaksi',
  );

  // Rute Bersama (HTML + payload RSC) tanpa entri dan dompet Pribadi.
  const html = await (await page.request.get('/bersama/transaksi')).text();
  const rsc = await (
    await page.request.get('/bersama/transaksi', { headers: { RSC: '1' } })
  ).text();
  expect(html).toContain('Kas Rumah');
  expect(html + rsc).not.toContain(PRIBADI_KANARI);
  expect(html + rsc).not.toContain(PRIBADI_WALLET);
  await page.goto('/bersama/transaksi');
  await expect(main.getByRole('listitem')).toHaveCount(1);
  await expect(main.getByRole('listitem')).toContainText('Saldo awal · Kas Rumah');
  await expect(main.getByText(PRIBADI_KANARI)).toHaveCount(0);
  await checkScreen(page);
});

/** Tangkapan tinjauan desain Detail nyata (SCREENS_REAL=1), menunggu teks `ready`. */
async function detailShots(page: Page, path: string, name: string, ready: string) {
  if (!process.env.SCREENS_REAL) return;
  await transaksiShots(page, path, name, ready);
  // Tangkapan meninggalkan `?theme=` di URL (dibawa tautan kembali); kembali ke alamat polos.
  await page.goto(path);
}

test('pemilik: Detail nyata: Ubah, konflik versi dari tab lain, Batalkan + Urungkan, Pulihkan', async ({
  browser,
}) => {
  const page = ownerPage;
  const main = page.getByRole('main');
  const toasts = page.getByRole('region', { name: /Notifikasi/ });
  await page.goto('/pribadi/transaksi');
  await main.getByRole('link', { name: new RegExp(PRIBADI_KANARI) }).click();
  await expect(page).toHaveURL(/\/pribadi\/transaksi\/[0-9a-f-]{36}$/);
  const path = new URL(page.url()).pathname;
  const id = path.split('/').at(-1) ?? '';
  const res = await page.request.get(path);
  expect(res.headers()['cache-control'] ?? '').toContain('no-store');
  await expect(main.getByRole('heading', { level: 1, name: PRIBADI_KANARI })).toBeVisible();
  await expect(main.getByRole('definition').filter({ hasText: /^kamu$/ })).toBeVisible();
  // Mode nyata S6: tanpa Pindahkan ke ruang lain (S7), tanpa data demo.
  await expect(main.getByRole('button', { name: 'Pindahkan ke ruang lain' })).toHaveCount(0);
  await expect(page.getByText('Data demo')).toHaveCount(0);
  await checkScreen(page);
  await detailShots(page, path, 'detail-hidup', PRIBADI_KANARI);

  // S6-D1: Ubah nominal, field lain tetap (ganti-penuh), toast menyebut ruang.
  await main.getByRole('button', { name: 'Ubah' }).click();
  const sheet = page.getByRole('dialog', { name: 'Ubah transaksi' });
  const amount = sheet.getByRole('textbox', { name: 'Nominal' });
  await expect(amount).toHaveValue('37.500');
  await expect(amount).toBeFocused();
  await expect(sheet.getByLabel(/Keterangan/)).toHaveValue(PRIBADI_KANARI);
  await amount.fill('40000');
  await sheet.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(toasts.getByText('Perubahan tersimpan di Pribadi')).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await expect(main.getByText(/^−Rp\s40\.000$/)).toBeVisible();
  await expect(main.getByRole('button', { name: 'Ubah' })).toBeFocused();

  // S6-D2: tab lain (konteks kedua, sesi yang sama) menyimpan lebih dulu; tab ini tidak menimpa diam-diam.
  await main.getByRole('button', { name: 'Ubah' }).click();
  await expect(amount).toHaveValue('40.000');
  const other = await browser.newContext({ storageState: await owner.storageState() });
  try {
    const tab = await other.newPage();
    await tab.goto(path);
    await tab.getByRole('main').getByRole('button', { name: 'Ubah' }).click();
    const tabSheet = tab.getByRole('dialog', { name: 'Ubah transaksi' });
    await tabSheet.getByRole('textbox', { name: 'Nominal' }).fill('45000');
    await tabSheet.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect(tabSheet).toHaveCount(0);
  } finally {
    await other.close();
  }
  await amount.fill('42000');
  await sheet.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(sheet.getByRole('alert')).toHaveText(
    /^Kamu mengubah transaksi ini baru saja \(Rp\s40\.000 → Rp\s45\.000\)\. Muat versi terbaru untuk melanjutkan\.$/,
  );
  await expect(sheet.getByRole('group', { name: 'Nilai terbaru' })).toContainText('45.000');
  await expect(sheet.getByRole('button', { name: 'Muat ulang' })).toBeFocused();
  await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
  await sheet.getByRole('button', { name: 'Timpa dengan perubahan saya' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(main.getByText(/^−Rp\s42\.000$/)).toBeVisible();

  // Batalkan: fokus awal Kembali, lalu daftar + toast Urungkan (6 detik) memulihkan entri.
  await main.getByRole('button', { name: 'Batalkan transaksi' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('button', { name: 'Kembali' })).toBeFocused();
  await expect(dialog).toContainText(
    `Transaksi Rp 42.000 dibatalkan. Saldo ${PRIBADI_WALLET} bertambah Rp 42.000. Bisa dipulihkan 90 hari dari Sampah.`,
  );
  await dialog.getByRole('button', { name: 'Batalkan transaksi' }).click();
  await expect(page).toHaveURL(/\/pribadi\/transaksi$/);
  await expect(main.getByText(PRIBADI_KANARI)).toHaveCount(0);
  await expect(
    toasts.getByText(`Dibatalkan di Pribadi · Rp 42.000 dari ${PRIBADI_WALLET}`),
  ).toBeVisible();
  await toasts.getByRole('button', { name: 'Urungkan' }).click();
  await expect(main.getByText(PRIBADI_KANARI)).toBeVisible();

  // S6-D3: entri batal tetap terbuka lewat URL (bukan 404): banner, nominal dicoret, Pulihkan.
  await page.goto(path);
  await main.getByRole('button', { name: 'Batalkan transaksi' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Batalkan transaksi' }).click();
  await expect(page).toHaveURL(/\/pribadi\/transaksi$/);
  await page.goto(path);
  await expect(main.getByText('Transaksi ini sudah dibatalkan.')).toBeVisible();
  await expect(main.getByText('dibatalkan', { exact: true })).toHaveCount(1);
  await expect(main.getByRole('button', { name: 'Ubah' })).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Batalkan transaksi' })).toHaveCount(0);
  await checkScreen(page);
  await detailShots(page, path, 'detail-batal', 'Transaksi ini sudah dibatalkan.');
  await main.getByRole('button', { name: 'Pulihkan' }).click();
  await expect(toasts.getByText('Dipulihkan di Pribadi · Rp 42.000')).toBeVisible();
  await expect(main.getByText('Transaksi ini sudah dibatalkan.')).toHaveCount(0);
  await expect(main.getByRole('heading', { level: 1 })).toBeFocused();
  await expect(main.getByRole('button', { name: 'Ubah' })).toBeVisible();

  // Id Pribadi di rute Bersama = 404; id tidak ada / bukan uuid = 404.
  for (const bad of [
    `/bersama/transaksi/${id}`,
    `/pribadi/transaksi/${randomUUID()}`,
    '/pribadi/transaksi/bukan-uuid',
  ]) {
    await page.goto(bad);
    await expect(page.getByText('This page could not be found.')).toBeVisible();
  }
});

const SAMPAH_KANARI = 'KANARI-SAMPAH-PRIBADI-E2E';
const SAMPAH_KOSONG =
  'Sampah kosong. Transaksi yang dibatalkan bisa dipulihkan di sini selama 90 hari.';

test('pemilik: Sampah nyata: batalkan, Menu → Sampah, Pulihkan, kembali di Transaksi; hanya ruang ini', async () => {
  const page = ownerPage;
  const main = page.getByRole('main');
  const toasts = page.getByRole('region', { name: /Notifikasi/ });
  await createExpense(OWNER, 'personal', PRIBADI_WALLET, 61_250, SAMPAH_KANARI);

  // Kosong: salinan S6-S1, no-store, tanpa data demo (yang dibatalkan di tes Detail sudah dipulihkan).
  const res = await page.goto('/pribadi/sampah');
  expect(res?.headers()['cache-control'] ?? '').toContain('no-store');
  await expect(main.getByRole('heading', { level: 1, name: 'Sampah · Pribadi' })).toBeVisible();
  await expect(main.getByText(SAMPAH_KOSONG)).toBeVisible();
  await expect(page.getByText('Data demo')).toHaveCount(0);
  await checkScreen(page);
  await transaksiShots(page, '/pribadi/sampah', 'sampah-kosong', SAMPAH_KOSONG);

  // Batalkan dari Detail, lalu Sampah lewat Menu.
  await page.goto('/pribadi/transaksi');
  await main.getByRole('link', { name: new RegExp(SAMPAH_KANARI) }).click();
  await main.getByRole('button', { name: 'Batalkan transaksi' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Batalkan transaksi' }).click();
  await expect(page).toHaveURL(/\/pribadi\/transaksi$/);
  await expect(main.getByText(SAMPAH_KANARI)).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu', exact: true }).filter({ visible: true }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Sampah' }).click();
  await expect(page).toHaveURL(/\/pribadi\/sampah$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const row = main.getByRole('listitem').filter({ hasText: SAMPAH_KANARI });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(PRIBADI_WALLET);
  await expect(row).toContainText('Dibatalkan Hari ini');
  await expect(row).toContainText(/Terhapus permanen \p{L}{3}, \d{1,2} \p{L}{3} \d{4}/u);
  await expect(row).toContainText('61.250');
  await expect(row.getByRole('link')).toHaveCount(0);
  await expect(page.getByText('Data demo')).toHaveCount(0);
  await checkScreen(page);
  await transaksiShots(page, '/pribadi/sampah', 'sampah-daftar', SAMPAH_KANARI);

  // Rute Bersama (HTML + payload RSC): Sampah tanpa data Pribadi.
  const html = await (await page.request.get('/bersama/sampah')).text();
  const rsc = await (await page.request.get('/bersama/sampah', { headers: { RSC: '1' } })).text();
  expect(html + rsc).not.toContain(SAMPAH_KANARI);
  expect(html + rsc).not.toContain(PRIBADI_WALLET);
  await page.goto('/bersama/sampah');
  await expect(main.getByRole('heading', { level: 1, name: 'Sampah · Bersama' })).toBeVisible();
  await expect(main.getByText(SAMPAH_KOSONG)).toBeVisible();

  // Pulihkan: toast menyebut ruang, baris hilang, fokus ke judul (daftar habis), entri kembali.
  await page.goto('/pribadi/sampah');
  await row.getByRole('button', { name: new RegExp(`^Pulihkan ${SAMPAH_KANARI}`) }).click();
  await expect(toasts.getByText('Dipulihkan di Pribadi · Rp 61.250')).toBeVisible();
  await expect(main.getByText(SAMPAH_KOSONG)).toBeVisible();
  await expect(main.getByRole('heading', { level: 1 })).toBeFocused();
  await main.getByRole('link', { name: 'Transaksi' }).click();
  await expect(page).toHaveURL(/\/pribadi\/transaksi$/);
  await expect(main.getByText(SAMPAH_KANARI)).toBeVisible();
});

test('pemilik: undang pasangan, undangan tertunda', async () => {
  const page = ownerPage;
  await page.goto('/undang');
  await checkScreen(page);
  await page.getByLabel('Email pasangan').fill(PARTNER);
  await page.getByRole('button', { name: 'Kirim undangan' }).click();
  await expect(page.getByText(`Undangan terkirim ke ${PARTNER}.`)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Undangan tertunda' })).toBeVisible();
  await checkScreen(page);
});

test('tautan undangan salah: halaman galat seragam', async () => {
  await partnerPage.goto('/terima-undangan?t=salah');
  await expect(
    partnerPage.getByRole('heading', { name: 'Undangan ini tidak berlaku' }),
  ).toBeVisible();
  await checkScreen(partnerPage);
});

test('pasangan: terima, buat akun, amankan dengan TOTP (kode salah lalu benar)', async () => {
  const page = partnerPage;
  const mail = await lastMail(/mengundangmu/);
  expect(mail.to).toBe(PARTNER);
  await page.goto(linkIn(mail.text));
  await expect(page.getByText(`Undangan untuk ${PARTNER}.`)).toBeVisible();
  await checkScreen(page);
  await page.getByRole('link', { name: 'Terima undangan' }).click();
  await expect(page.getByText(PARTNER)).toBeVisible();
  await checkScreen(page);
  await page.getByLabel('Nama panggilan').fill('Farida');
  await page.getByLabel('Kata sandi baru').fill(PASSWORD);
  await page.getByRole('button', { name: 'Buat akun' }).click();
  await expect(page).toHaveURL(/\/amankan$/);

  // Sesi kata sandi saja: request RSC langsung ke page ruang tetap dialihkan, tanpa isi page.
  for (const path of ['/pribadi/beranda', '/bersama/transaksi', '/pribadi/dompet']) {
    const rsc = await page.request.get(path, { headers: { RSC: '1' } });
    const location = rsc.headers().location ?? '';
    const body = await rsc.text();
    expect(location + body).toContain('/amankan');
  }

  await page.getByRole('button', { name: 'Pakai aplikasi autentikator' }).click();
  await page.getByLabel('Kata sandi', { exact: true }).fill('salah-salah-salah');
  await page.getByRole('button', { name: 'Lanjut' }).click();
  await expect(page.getByText('Kata sandi salah.')).toBeVisible();
  await page.getByLabel('Kata sandi', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Lanjut' }).click();
  await expect(
    page.getByRole('img', { name: 'Kode QR untuk aplikasi autentikator' }),
  ).toBeVisible();
  await checkScreen(page);
  partnerSecret = (await page.locator('code').first().innerText()).replace(/\s/g, '');

  await page.getByLabel('Kode 6 angka').fill('000000');
  await page.getByRole('button', { name: 'Verifikasi' }).click();
  await expect(page.getByText('Kode salah.')).toBeVisible();
  await page.getByLabel('Kode 6 angka').fill(totp(partnerSecret));
  await page.getByRole('button', { name: 'Verifikasi' }).click();
  await expect(page.getByRole('heading', { name: 'Simpan kode pemulihan' })).toBeVisible();
  await page.getByRole('button', { name: 'Buat kode pemulihan' }).click();
  await page.getByLabel('Saya sudah menyimpan kode ini di tempat yang aman.').check();
  await page.getByRole('button', { name: 'Selesai' }).click();
  await expect(page).toHaveURL(/\/pribadi\/beranda$/);
});

test('pemilik: ruang Bersama lengkap, undangan diterima', async () => {
  await ownerPage.goto('/undang');
  await expect(ownerPage.getByText('Ruang Bersama sudah berisi dua orang.')).toBeVisible();
  await expect(ownerPage.getByText('Diterima')).toBeVisible();
});

test('pasangan: keluar, masuk lagi dengan kata sandi + TOTP', async () => {
  const page = partnerPage;
  await page.goto('/undang');
  await page.getByRole('button', { name: 'Keluar' }).click();
  await expect(page.getByText('Kamu sudah keluar.')).toBeVisible();
  await page.getByLabel('Email').fill(PARTNER);
  await page.getByLabel('Kata sandi', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Masukkan kode 6 digit' })).toBeVisible();
  await checkScreen(page);
  await page.getByLabel('Kode 6 angka').fill('111111');
  await page.getByRole('button', { name: 'Verifikasi' }).click();
  await expect(page.getByText('Kode salah.')).toBeVisible();
  await page.getByLabel('Kode 6 angka').fill(totp(partnerSecret));
  await page.getByRole('button', { name: 'Verifikasi' }).click();
  await expect(page).toHaveURL(/\/pribadi\/beranda$/);
});

test('pemilik: keluar lalu masuk dengan passkey', async () => {
  const page = ownerPage;
  await page.goto('/undang');
  await page.getByRole('button', { name: 'Keluar' }).click();
  await expect(page).toHaveURL(/\/masuk\?status=keluar$/);
  // Kata sandi saja tidak membuka akun berpasskey.
  await page.getByLabel('Email').fill(OWNER);
  await page.getByLabel('Kata sandi', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  // Respons sama dengan kata sandi salah: tidak mengonfirmasi kata sandi akun berpasskey.
  await expect(page.getByText('Email atau kata sandi salah.')).toBeVisible();
  await page.getByRole('button', { name: 'Masuk dengan passkey' }).click();
  await expect(page).toHaveURL(/\/pribadi\/beranda$/);
});

test('passkey dibatalkan: pesan jelas dan jalur kata sandi', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/masuk');
  // Pengguna menutup dialog passkey: peramban menolak dengan NotAllowedError.
  await page.evaluate(() => {
    navigator.credentials.get = () =>
      Promise.reject(new DOMException('dibatalkan', 'NotAllowedError'));
  });
  await page.getByRole('button', { name: 'Masuk dengan passkey' }).click();
  await expect(page.getByText(/Passkey dibatalkan atau tidak ditemukan/)).toBeVisible();
  await checkScreen(page);
});

test('kode pemulihan: masuk, hanya boleh mendaftar cara masuk baru', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/masuk');
  await page.getByRole('button', { name: 'Pakai kode pemulihan' }).click();
  await checkScreen(page);
  await page.getByLabel('Email').fill(OWNER);
  await page.getByLabel('Kode pemulihan').fill('AAAAA-AAAAA');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByText('Email atau kode pemulihan salah.')).toBeVisible();
  await page.getByLabel('Kode pemulihan').fill(ownerCodes[0] ?? '');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByRole('heading', { name: 'Daftarkan cara masuk baru' })).toBeVisible();
  await page.goto('/pribadi/beranda');
  await expect(page).toHaveURL(/\/amankan$/);
  expect((await lastMail(/pemulihan/)).to).toBe(OWNER);
  // Sesi pemilik lain dicabut.
  await ownerPage.goto('/pribadi/beranda');
  await expect(ownerPage).toHaveURL(/\/masuk/);
});

test('lupa kata sandi: respons seragam, tautan, kata sandi baru', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/masuk');
  await page.getByRole('link', { name: 'Lupa kata sandi?' }).click();
  await expect(page.getByRole('heading', { name: 'Lupa kata sandi' })).toBeVisible();
  await checkScreen(page);
  await page.getByLabel('Email').fill(PARTNER);
  await page.getByRole('button', { name: 'Kirim tautan' }).click();
  await expect(page.getByText(`Kalau ${PARTNER} terdaftar`)).toBeVisible();
  await page.goto(linkIn((await lastMail(/Atur ulang/)).text));
  await checkScreen(page);
  await page.getByLabel('Kata sandi baru').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Simpan kata sandi' }).click();
  await expect(page.getByText('Kata sandi sudah diganti')).toBeVisible();
  // Sesi lama pasangan dicabut.
  await partnerPage.goto('/pribadi/beranda');
  await expect(partnerPage).toHaveURL(/\/masuk/);
  // Masuk lagi tetap butuh TOTP (2FA tidak dimatikan reset).
  await page.getByLabel('Email').fill(PARTNER);
  await page.getByLabel('Kata sandi', { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Masukkan kode 6 digit' })).toBeVisible();
});

// Terakhir: jeda berlaku per IP juga, dan semua request tes datang dari IP yang sama.
test('5 kata sandi salah dengan X-Forwarded-For palsu: tetap dijeda', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/masuk');
  for (let i = 0; i < 5; i++) {
    // Email tak terdaftar: penghitung dan pesannya sama dengan akun yang ada.
    await page.getByLabel('Email').fill('tamu@example.test');
    // X-Forwarded-For palsu berganti tiap percobaan: jeda per akun tetap berlaku.
    await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': `203.0.113.${String(i + 1)}` });
    await page.getByLabel('Kata sandi', { exact: true }).fill(`salah-sekali-${String(i)}-xx`);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    if (i < 4) await expect(page.getByText('Email atau kata sandi salah.')).toBeVisible();
  }
  await expect(page.getByText('Terlalu banyak percobaan. Coba lagi dalam 1 menit.')).toBeVisible();
  await checkScreen(page);
});
