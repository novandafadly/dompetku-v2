import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  PORTFOLIO_MAIL_FILE,
  PORTFOLIO_OWNER_STATE,
  PORTFOLIO_PARTNER_STATE,
} from '../../playwright.portfolio.config';
import {
  addPasskeyAuthenticator,
  adminQuery,
  asUser,
  lastMail,
  linkIn,
  noHorizontalScroll,
  PASSWORD,
  spaceOf,
  totp,
} from '../e2e-auth/helpers';
import { PORTFOLIO_OWNER, PORTFOLIO_PARTNER } from './global-setup';

/**
 * Generator tangkapan layar portofolio otomatis (M7 / S19).
 *
 * Seluruh nama, email, saldo, dan transaksi di berkas ini 100% fiktif (Raka & Nadia).
 * Tidak pernah memakai data produksi. Memotret 10 layar utama × 2 lebar (390, 1280) × 2 tema
 * (dark, light) ke `docs/screenshots/portfolio/` (atau `process.env.PORTFOLIO_DIR`).
 */
const OUT_DIR =
  process.env.PORTFOLIO_DIR ??
  fileURLToPath(new URL('../../../../docs/screenshots/portfolio/', import.meta.url));
const WIDTHS = [390, 1280] as const;
const THEMES = ['dark', 'light'] as const;
const EMPTY_STATE = { cookies: [], origins: [] };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isoOffset(baseIso: string, deltaDays: number): string {
  const [y, m, d] = baseIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, (d ?? 1) + deltaDays));
  return `${String(dt.getUTCFullYear())}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function monthStartOf(baseIso: string): string {
  return `${baseIso.slice(0, 7)}-01`;
}

async function registerDemoOwner(browser: Browser, baseURL: string): Promise<void> {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await page.goto('/buat-akun');
    await page.getByLabel('Email').fill(PORTFOLIO_OWNER);
    await page.getByLabel('Nama panggilan').fill('Raka');
    await page.getByLabel('Kata sandi baru').fill(PASSWORD);
    await page.getByRole('button', { name: 'Buat akun' }).click();
    await expect(page.getByRole('heading', { name: 'Periksa email' })).toBeVisible();
    await page.goto(linkIn((await lastMail(/Konfirmasi email/, PORTFOLIO_MAIL_FILE)).text));
    await page.getByRole('button', { name: 'Konfirmasi email' }).click();
    await expect(page.getByText('Email terkonfirmasi.')).toBeVisible();
    await page.getByLabel('Email').fill(PORTFOLIO_OWNER);
    await page.getByLabel('Kata sandi', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page).toHaveURL(/\/amankan$/);
    await addPasskeyAuthenticator(page);
    await page.getByRole('button', { name: 'Buat passkey' }).click();
    await page.getByRole('button', { name: 'Buat kode pemulihan' }).click();
    await page.getByLabel('Saya sudah menyimpan kode ini di tempat yang aman.').check();
    await page.getByRole('button', { name: 'Selesai' }).click();
    await expect(page).toHaveURL(/\/pribadi\/beranda$/);
    await context.storageState({ path: PORTFOLIO_OWNER_STATE });
  } finally {
    await context.close();
  }
}

async function registerDemoPartner(browser: Browser, baseURL: string): Promise<void> {
  const ownerCtx = await browser.newContext({
    baseURL,
    storageState: PORTFOLIO_OWNER_STATE,
    serviceWorkers: 'block',
  });
  try {
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto('/undang');
    await ownerPage.getByLabel('Email pasangan').fill(PORTFOLIO_PARTNER);
    await ownerPage.getByRole('button', { name: 'Kirim undangan' }).click();
    await expect(ownerPage.getByText(`Undangan terkirim ke ${PORTFOLIO_PARTNER}.`)).toBeVisible();
  } finally {
    await ownerCtx.close();
  }

  const partnerCtx = await browser.newContext({
    baseURL,
    storageState: EMPTY_STATE,
    serviceWorkers: 'block',
  });
  try {
    const page = await partnerCtx.newPage();
    const mail = await lastMail(/mengundangmu/, PORTFOLIO_MAIL_FILE);
    await page.goto(linkIn(mail.text));
    await page.getByRole('link', { name: 'Terima undangan' }).click();
    await page.getByLabel('Nama panggilan').fill('Nadia');
    await page.getByLabel('Kata sandi baru').fill(PASSWORD);
    await page.getByRole('button', { name: 'Buat akun' }).click();
    await expect(page).toHaveURL(/\/amankan$/);
    await page.getByRole('button', { name: 'Pakai aplikasi autentikator' }).click();
    await page.getByLabel('Kata sandi', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Lanjut' }).click();
    await expect(
      page.getByRole('img', { name: 'Kode QR untuk aplikasi autentikator' }),
    ).toBeVisible();
    const secret = (await page.locator('code').first().innerText()).replace(/\s/g, '');
    await page.getByLabel('Kode 6 angka').fill(totp(secret));
    await page.getByRole('button', { name: 'Verifikasi' }).click();
    await expect(page.getByRole('heading', { name: 'Simpan kode pemulihan' })).toBeVisible();
    await page.getByRole('button', { name: 'Buat kode pemulihan' }).click();
    await page.getByLabel('Saya sudah menyimpan kode ini di tempat yang aman.').check();
    await page.getByRole('button', { name: 'Selesai' }).click();
    await expect(page).toHaveURL(/\/pribadi\/beranda$/);
    await partnerCtx.storageState({ path: PORTFOLIO_PARTNER_STATE });
  } finally {
    await partnerCtx.close();
  }
}

async function createAccount(
  uid: string,
  sid: string,
  name: string,
  pocket: 'operasional' | 'tabungan' | 'kantor' | 'trading' | 'aset',
  walletType: 'cash' | 'bank' | 'ewallet',
  openedOn: string,
  openingBalance: number,
  assetKind: string | null = null,
): Promise<string> {
  const [row] = await asUser<{ r: { account_id: string } }>(
    uid,
    `select api.create_account(
       p_client_id => $1, p_space_id => $2, p_name => $3, p_pocket => $4::app.pocket,
       p_wallet_type => $5::app.wallet_type, p_opened_on => $6::date,
       p_opening_balance => $7::bigint, p_asset_kind => $8
     ) as r`,
    [randomUUID(), sid, name, pocket, walletType, openedOn, openingBalance, assetKind],
  );
  if (!row) throw new Error(`gagal buat akun ${name}`);
  return row.r.account_id;
}

async function seedPortfolioData(): Promise<{ tripId: string }> {
  const [todayRow] = await adminQuery<{ d: string }>(`select app.today()::text as d`);
  const today = todayRow?.d ?? '2026-11-25';
  const monthStart = monthStartOf(today);
  const openedOn = isoOffset(monthStart, -30);

  const raka = await spaceOf(PORTFOLIO_OWNER, 'personal');
  const nadia = await spaceOf(PORTFOLIO_PARTNER, 'personal');
  const bersama = await spaceOf(PORTFOLIO_OWNER, 'shared');

  // Ambil kategori default Pribadi Raka dan Bersama.
  const rakaCats = await adminQuery<{ id: string; name: string; type: string }>(
    `select id::text, name, type::text from app.categories where space_id = $1 and parent_id is null order by sort_order`,
    [raka.sid],
  );
  const bersamaCats = await adminQuery<{ id: string; name: string; type: string }>(
    `select id::text, name, type::text from app.categories where space_id = $1 and parent_id is null order by sort_order`,
    [bersama.sid],
  );

  const findCat = (
    list: { id: string; name: string; type: string }[],
    type: 'expense' | 'income',
    pattern: RegExp,
    fallbackIdx = 0,
  ): string => {
    const typed = list.filter((c) => c.type === type);
    const hit = typed.find((c) => pattern.test(c.name)) ?? typed[fallbackIdx] ?? typed[0];
    if (!hit) throw new Error(`kategori tidak ketemu: ${type} ${String(pattern)}`);
    return hit.id;
  };

  const catGaji = findCat(rakaCats, 'income', /gaji/i, 0);
  const catMakan = findCat(rakaCats, 'expense', /makan/i, 0);
  const catTransport = findCat(rakaCats, 'expense', /transport/i, 1);
  const catBelanja = findCat(rakaCats, 'expense', /belanja/i, 2);
  const catTagihan = findCat(rakaCats, 'expense', /tagihan|utilitas|rumah/i, 3);
  const catHiburan = findCat(rakaCats, 'expense', /hiburan|lain/i, 4);

  // Subkategori Kopi di bawah Makan agar tampilan anggaran subkategori tampil nyata.
  const [subKopiRow] = await asUser<{ r: { category_id: string } }>(
    raka.uid,
    `select api.create_category($1, $2, 'expense'::app.category_type, 'Kopi & Camilan', 'Coffee', $3) as r`,
    [randomUUID(), raka.sid, catMakan],
  );
  const catKopi = subKopiRow?.r.category_id ?? catMakan;

  const catBersamaBelanja = findCat(bersamaCats, 'expense', /belanja|dapur|makan/i, 0);
  const catBersamaRumah = findCat(bersamaCats, 'expense', /tagihan|rumah|utilitas/i, 1);

  // 1. Dompet Pribadi Raka (Operasional, Tabungan, Trading, Aset, Saham).
  const bca = await createAccount(
    raka.uid,
    raka.sid,
    'BCA Utama',
    'operasional',
    'bank',
    openedOn,
    12_500_000,
  );
  const gopay = await createAccount(
    raka.uid,
    raka.sid,
    'GoPay',
    'operasional',
    'ewallet',
    openedOn,
    1_150_000,
  );
  const tunai = await createAccount(
    raka.uid,
    raka.sid,
    'Tunai',
    'operasional',
    'cash',
    openedOn,
    650_000,
  );
  const darurat = await createAccount(
    raka.uid,
    raka.sid,
    'Dana Darurat',
    'tabungan',
    'bank',
    openedOn,
    24_000_000,
  );
  const rdn = await createAccount(
    raka.uid,
    raka.sid,
    'RDN Mandiri',
    'trading',
    'bank',
    openedOn,
    18_000_000,
  );
  await createAccount(
    raka.uid,
    raka.sid,
    'Emas Antam 10g',
    'aset',
    'cash',
    openedOn,
    14_800_000,
    'emas',
  );
  await createAccount(
    raka.uid,
    raka.sid,
    'Reksa Dana Pasar Uang',
    'aset',
    'bank',
    openedOn,
    12_500_000,
    'reksa_dana',
  );
  const sahamAcc = await createAccount(
    raka.uid,
    raka.sid,
    'Portofolio IDX',
    'aset',
    'bank',
    openedOn,
    0,
    'saham',
  );

  // Dompet Pribadi Nadia (untuk setoran ke Bersama).
  const nadiaBank = await createAccount(
    nadia.uid,
    nadia.sid,
    'Mandiri Nadia',
    'operasional',
    'bank',
    openedOn,
    10_000_000,
  );

  // Dompet Ruang Bersama.
  const kasRumah = await createAccount(
    raka.uid,
    bersama.sid,
    'Kas Rumah BCA',
    'operasional',
    'bank',
    openedOn,
    4_500_000,
  );
  const tabRumah = await createAccount(
    raka.uid,
    bersama.sid,
    'Tabungan Rumah',
    'tabungan',
    'bank',
    openedOn,
    18_500_000,
  );

  // 2. Pembelian saham IDX + harga pasar terakhir.
  await asUser(
    raka.uid,
    `select api.buy_stock($1, $2, 'BBCA', 500, 9850, 7500, $3, $4::date, false)`,
    [randomUUID(), sahamAcc, rdn, isoOffset(today, -12)],
  );
  await asUser(
    raka.uid,
    `select api.buy_stock($1, $2, 'BMRI', 1000, 6550, 10000, $3, $4::date, false)`,
    [randomUUID(), sahamAcc, rdn, isoOffset(today, -9)],
  );
  await asUser(raka.uid, `select api.set_stock_price($1, $2, 'BBCA', $3::date, 10250, false)`, [
    randomUUID(),
    raka.sid,
    today,
  ]);
  await asUser(raka.uid, `select api.set_stock_price($1, $2, 'BMRI', $3::date, 6925, false)`, [
    randomUUID(),
    raka.sid,
    today,
  ]);

  // 3. Tujuan tabungan (Pribadi & Bersama).
  await asUser(
    raka.uid,
    `select api.create_goal($1, $2, $3, 'Dana darurat 6 bulan', 36000000, $4::date)`,
    [randomUUID(), raka.sid, darurat, isoOffset(today, 210)],
  );
  await asUser(
    raka.uid,
    `select api.create_goal($1, $2, $3, 'DP Renovasi Dapur', 30000000, $4::date)`,
    [randomUUID(), bersama.sid, tabRumah, isoOffset(today, 270)],
  );

  // 4. Trip Pribadi ("Liburan Jogja") + 3 transaksi trip.
  const [tripRow] = await asUser<{ r: { trip_id: string } }>(
    raka.uid,
    `select api.create_trip($1, $2, 'Liburan Jogja', $3::date, $4::date, 4500000) as r`,
    [randomUUID(), raka.sid, isoOffset(today, -6), isoOffset(today, -3)],
  );
  const tripId = tripRow?.r.trip_id;
  if (!tripId) throw new Error('gagal buat trip demo');

  const addEntry = async (
    uid: string,
    sid: string,
    accId: string,
    kind: 'expense' | 'income',
    amount: number,
    catId: string,
    on: string,
    desc: string,
    trip: string | null = null,
  ) => {
    await asUser(
      uid,
      `select api.create_entry($1, $2, $3, $4::app.entry_kind, $5::bigint, $6, $7::date, $8, false, false, $9)`,
      [randomUUID(), sid, accId, kind, amount, catId, on, desc, trip],
    );
  };

  // 5. Pemasukan & pengeluaran Pribadi Raka bulan ini (realistis & rapi).
  await addEntry(
    raka.uid,
    raka.sid,
    bca,
    'income',
    14_500_000,
    catGaji,
    monthStart,
    'Gaji bulanan',
  );
  await addEntry(
    raka.uid,
    raka.sid,
    bca,
    'expense',
    1_150_000,
    catTransport,
    isoOffset(today, -6),
    'Tiket kereta eksekutif PP',
    tripId,
  );
  await addEntry(
    raka.uid,
    raka.sid,
    bca,
    'expense',
    1_680_000,
    catHiburan,
    isoOffset(today, -5),
    'Hotel Malioboro 2 malam',
    tripId,
  );
  await addEntry(
    raka.uid,
    raka.sid,
    tunai,
    'expense',
    340_000,
    catMakan,
    isoOffset(today, -4),
    'Kuliner gudeg & oleh-oleh bakpia',
    tripId,
  );

  await addEntry(
    raka.uid,
    raka.sid,
    gopay,
    'expense',
    38_000,
    catKopi,
    today,
    'Kopi susu aren pagi',
  );
  await addEntry(
    raka.uid,
    raka.sid,
    gopay,
    'expense',
    52_000,
    catMakan,
    today,
    'Makan siang ayam bakar',
  );
  await addEntry(
    raka.uid,
    raka.sid,
    gopay,
    'expense',
    28_000,
    catTransport,
    isoOffset(today, -1),
    'MRT & ojek kantor',
  );
  await addEntry(
    raka.uid,
    raka.sid,
    bca,
    'expense',
    425_000,
    catBelanja,
    isoOffset(today, -2),
    'Belanja kebutuhan bulanan',
  );
  await addEntry(
    raka.uid,
    raka.sid,
    tunai,
    'expense',
    45_000,
    catMakan,
    isoOffset(today, -2),
    'Bakso sore',
  );
  await addEntry(
    raka.uid,
    raka.sid,
    bca,
    'expense',
    169_000,
    catHiburan,
    isoOffset(today, -3),
    'Langganan musik & cloud',
  );
  await addEntry(
    raka.uid,
    raka.sid,
    gopay,
    'expense',
    42_000,
    catKopi,
    isoOffset(today, -5),
    'Es matcha sore',
  );
  await addEntry(
    raka.uid,
    raka.sid,
    bca,
    'expense',
    310_000,
    catBelanja,
    isoOffset(today, -7),
    'Sepatu lari diskon',
  );

  // 6. Anggaran induk + subkategori bulan berjalan.
  await asUser(raka.uid, `select api.set_budget($1, $2, $3::date, 2500000, true)`, [
    raka.sid,
    catMakan,
    monthStart,
  ]);
  await asUser(raka.uid, `select api.set_budget($1, $2, $3::date, 450000, false)`, [
    raka.sid,
    catKopi,
    monthStart,
  ]);
  await asUser(raka.uid, `select api.set_budget($1, $2, $3::date, 1500000, true)`, [
    raka.sid,
    catTransport,
    monthStart,
  ]);
  await asUser(raka.uid, `select api.set_budget($1, $2, $3::date, 1200000, false)`, [
    raka.sid,
    catBelanja,
    monthStart,
  ]);
  await asUser(raka.uid, `select api.set_budget($1, $2, $3::date, 800000, false)`, [
    raka.sid,
    catHiburan,
    monthStart,
  ]);

  // 7. Tagihan rutin (menampilkan jatuh tempo mendatang atau lewat jatuh tempo di Beranda & Kalender).
  const dayNum = Number(today.slice(8, 10));
  const dueSoon1 = Math.min(28, dayNum < 25 ? dayNum + 3 : 5);
  const dueSoon2 = Math.min(28, dayNum < 22 ? dayNum + 6 : 12);
  const dueSoon3 = Math.min(28, dayNum < 18 ? dayNum + 10 : 18);

  await asUser(
    raka.uid,
    `select api.create_bill($1, $2, 'Internet Fiber Rumah', 385000, $3, $4::smallint, $5::date, null, $6)`,
    [randomUUID(), raka.sid, catTagihan, dueSoon1, monthStart, bca],
  );
  await asUser(
    raka.uid,
    `select api.create_bill($1, $2, 'Listrik PLN Pascabayar', 520000, $3, $4::smallint, $5::date, null, $6)`,
    [randomUUID(), raka.sid, catTagihan, dueSoon2, monthStart, bca],
  );
  await asUser(
    raka.uid,
    `select api.create_bill($1, $2, 'Keanggotaan Gym', 275000, $3, $4::smallint, $5::date, null, $6)`,
    [randomUUID(), raka.sid, catHiburan, dueSoon3, monthStart, bca],
  );

  // Materialize tagihan 45 hari ke depan supaya Kalender Arus Kas & Tagihan mendatang penuh.
  await adminQuery(`select jobs.materialize_bills($1::date)`, [isoOffset(today, 45)]);

  // 8. Piutang fiktif di Rencana > Utang.
  await asUser(
    raka.uid,
    `select api.create_debt($1, $2, 'lent', 750000, 'berjalan', null, 'Dimas Pratama', null, $3::date, 'Patungan tiket konser', 'Dilunasi awal bulan depan', false)`,
    [randomUUID(), raka.sid, isoOffset(today, -4)],
  );

  // 9. Aktivitas Ruang Bersama (setoran Raka & Nadia, pengeluaran Bersama, Patungan).
  await asUser(
    raka.uid,
    `select api.create_transfer($1, $2, $3, $4, 3000000, 0, $5::date, 'Setor kas bulanan', 'Setoran bulanan Raka', false)`,
    [randomUUID(), raka.sid, bca, kasRumah, isoOffset(today, -8)],
  );
  await asUser(
    nadia.uid,
    `select api.create_transfer($1, $2, $3, $4, 2500000, 0, $5::date, 'Setor kas bulanan', 'Setoran bulanan Nadia', false)`,
    [randomUUID(), nadia.sid, nadiaBank, kasRumah, isoOffset(today, -7)],
  );
  await addEntry(
    raka.uid,
    bersama.sid,
    kasRumah,
    'expense',
    845_000,
    catBersamaBelanja,
    isoOffset(today, -3),
    'Belanja supermarket mingguan',
  );
  await addEntry(
    nadia.uid,
    bersama.sid,
    kasRumah,
    'expense',
    410_000,
    catBersamaRumah,
    isoOffset(today, -1),
    'Tagihan air & IPL klaster',
  );
  await asUser(
    raka.uid,
    `select api.create_split($1, $2, $3, 420000, $4, $5::date, 'Makan malam keluarga', null, false, null)`,
    [randomUUID(), bersama.sid, bca, catBersamaBelanja, today],
  );
  await asUser(raka.uid, `select api.set_budget($1, $2, $3::date, 3500000, true)`, [
    bersama.sid,
    catBersamaBelanja,
    monthStart,
  ]);

  return { tripId };
}

async function captureScreen(
  browser: Browser,
  baseURL: string,
  name: string,
  urlPath: string,
  afterLoad?: (p: Page) => Promise<void>,
): Promise<void> {
  const ctx = await browser.newContext({
    baseURL,
    storageState: PORTFOLIO_OWNER_STATE,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  try {
    const page = await ctx.newPage();
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
        const sep = urlPath.includes('?') ? '&' : '?';
        await page.goto(`${urlPath}${sep}theme=${theme}`);
        await expect(page).not.toHaveURL(/\/masuk/);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('main')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        if (afterLoad) {
          await afterLoad(page);
          await page.evaluate(() => document.fonts.ready);
        }
        // Verifikasi kualitas: bebas gulir horizontal & nol nama asli pemilik.
        await noHorizontalScroll(page);
        const bodyText = await page.locator('body').innerText();
        expect(
          bodyText,
          `nama asli tidak boleh muncul di screenshot portofolio (${name})`,
        ).not.toMatch(/\b(Novanda|Farida)\b/i);
        await page.waitForTimeout(150);
        await page.screenshot({
          path: path.join(OUT_DIR, `${name}-${String(width)}-${theme}.png`),
          animations: 'disabled',
        });
      }
    }
  } finally {
    await ctx.close();
  }
}

test.describe.configure({ mode: 'serial' });

let seededTripId = '';

test.beforeAll(async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3304';
  await mkdir(OUT_DIR, { recursive: true });
  const [existingTrip] = await adminQuery<{ id: string }>(
    `select id::text from app.trips where name = 'Liburan Jogja' limit 1`,
  );
  if (existingTrip) {
    seededTripId = existingTrip.id;
    return;
  }
  await registerDemoOwner(browser, baseURL);
  await registerDemoPartner(browser, baseURL);
  const { tripId } = await seedPortfolioData();
  seededTripId = tripId;
});

test('01 Beranda Pribadi', async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3304';
  await captureScreen(browser, baseURL, '01-beranda-pribadi', '/pribadi/beranda');
});

test('02 Sheet Catat cepat', async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3304';
  await captureScreen(browser, baseURL, '02-catat-sheet', '/pribadi/beranda', async (p) => {
    await p.getByRole('button', { name: 'Catat', exact: true }).filter({ visible: true }).click();
    const dialog = p.getByRole('dialog').first();
    const nom = dialog.getByLabel('Nominal', { exact: true });
    await expect(nom).toBeVisible();
    await nom.fill('45000');
    await dialog.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio').first().click();
    const toggleDesc = dialog.getByRole('button', { name: 'Tambah keterangan' });
    if (await toggleDesc.isVisible()) await toggleDesc.click();
    await dialog.getByRole('textbox', { name: /Keterangan/i }).fill('Kopi susu pagi');
    // Lepas fokus input agar kursor tidak berkedip di gambar.
    await p.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
  });
});

test('03 Daftar Transaksi', async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3304';
  await captureScreen(browser, baseURL, '03-transaksi', '/pribadi/transaksi');
});

test('04 Dompet & Kekayaan Bersih', async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3304';
  await captureScreen(browser, baseURL, '04-dompet-kekayaan', '/pribadi/dompet');
});

test('05 Rencana & Anggaran', async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3304';
  await captureScreen(browser, baseURL, '05-rencana-anggaran', '/pribadi/rencana');
});

test('06 Kalender Arus Kas', async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3304';
  await captureScreen(browser, baseURL, '06-kalender-arus-kas', '/pribadi/rencana/kalender');
});

test('07 Laporan Bulanan', async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3304';
  await captureScreen(browser, baseURL, '07-laporan', '/pribadi/laporan');
});

test('08 Beranda Ruang Bersama', async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3304';
  await captureScreen(browser, baseURL, '08-bersama-beranda', '/bersama/beranda');
});

test('09 Detail Trip', async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3304';
  await captureScreen(browser, baseURL, '09-trip-detail', `/pribadi/trip/${seededTripId}`);
});

test('10 Analisis AI', async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3304';
  await captureScreen(browser, baseURL, '10-analisis-ai', '/pribadi/analisis');
});
