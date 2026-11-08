import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Browser, Page } from '@playwright/test';
import { asUser, createWallet, spaceOf } from '../e2e-auth/helpers';
import { expectRouteBudget } from '../e2e-ledger/helpers';
import { expect, test } from './fixtures';
import { OWNER, PARTNER } from './global-setup';

/**
 * Screenshot layar S8 mode nyata (dua user) untuk design critique: Beranda Bersama dengan
 * Aktivitas dan Kontribusi, dilihat N (pemilik) dan F, keadaan kosong dua anggota dan berisi.
 * Bukan tes regresi: hanya jalan dengan `SCREENS=1` (config memilih tes bertanda `@screens`).
 * `SCREENS=1 pnpm e2e:bersama`; keluaran ke folder laporan Task 6.
 */
const OUT_DIR = fileURLToPath(
  new URL(
    '../../../../.superpowers/sdd/2026-11-04-dompetku-v2-s8-bersama/task-6-screens/',
    import.meta.url,
  ),
);
/** Halaman Aktivitas (Task 7) memakai folder laporannya sendiri. */
const OUT_DIR_AKTIVITAS = fileURLToPath(
  new URL(
    '../../../../.superpowers/sdd/2026-11-04-dompetku-v2-s8-bersama/task-7-screens/',
    import.meta.url,
  ),
);
/** Onboarding Farida (Task 8): S8-O1 (Pribadi baru) dan S8-O2 (Bersama berisi dompet Novanda). */
const OUT_DIR_T8 = fileURLToPath(
  new URL(
    '../../../../.superpowers/sdd/2026-11-04-dompetku-v2-s8-bersama/task-8-screens/',
    import.meta.url,
  ),
);
const BASE = 'http://localhost:3302';

interface Shot {
  w: number;
  h: number;
  dpr: number;
  theme: 'dark' | 'light';
}
const V = (w: number, themes: ('dark' | 'light')[] = ['dark', 'light'], dpr = 1): Shot[] =>
  themes.map((theme) => ({ w, h: w === 1280 ? 800 : w === 320 ? 640 : 844, dpr, theme }));
const ALL: Shot[] = [...V(320), ...V(390, ['dark', 'light'], 2), ...V(1280)];

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

/**
 * Persiapan tangkapan halaman penuh: bilah tab bawah (fixed) disembunyikan agar tidak menutup
 * baris terakhir; di 1280 viewport ditinggikan setinggi dokumen agar sidebar fixed (tinggi
 * viewport) mengisi seluruh tangkapan tanpa pita kosong di bawahnya.
 */
async function prepareFullPage(page: Page, v: Shot) {
  // CSSOM (bukan tag <style>): CSP halaman melarang gaya inline.
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('nav[aria-label="Tab utama"]').forEach((el) => {
      el.style.display = 'none';
    });
  });
  if (v.w === 1280) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: v.w, height: Math.max(v.h, h) });
    await settle(page);
  }
}

async function shoot(
  browser: Browser,
  state: string,
  name: string,
  path: string,
  shots = ALL,
  target: { dir: string; heading: string } = { dir: OUT_DIR, heading: 'Beranda' },
) {
  await mkdir(target.dir, { recursive: true });
  for (const v of shots) {
    const context = await browser.newContext({
      storageState: state,
      viewport: { width: v.w, height: v.h },
      deviceScaleFactor: v.dpr,
      reducedMotion: 'reduce',
      baseURL: BASE,
    });
    try {
      const page = await context.newPage();
      await page.goto(`${path}${path.includes('?') ? '&' : '?'}theme=${v.theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', v.theme);
      await expect(page.getByRole('heading', { name: target.heading }).first()).toBeVisible();
      await settle(page);
      await prepareFullPage(page, v);
      await page.screenshot({
        path: `${target.dir}${name}-${String(v.w)}-${v.theme}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 0)
        console.log(`OVERFLOW ${name} ${String(v.w)} ${v.theme}: +${String(overflow)}px`);
    } finally {
      await context.close();
    }
  }
}

const BERSAMA_WALLET = 'Kas Rumah';
const BESAR_WALLET = 'Tabungan Besar N';

interface Ids {
  nUid: string;
  fUid: string;
  bersama: string;
  nPribadi: string;
  fPribadi: string;
  accKas: string;
  accNBesar: string;
  accFKanari: string;
  accNKanari: string;
  catMakan: string;
  catLain: string;
}

async function ids(): Promise<Ids> {
  const n = await spaceOf(OWNER, 'shared');
  const nP = await spaceOf(OWNER, 'personal');
  const f = await spaceOf(PARTNER, 'personal');
  const acc = async (uid: string, space: string, name: string) => {
    const [r] = await asUser<{ id: string }>(
      uid,
      'select id::text from app.accounts where space_id = $1 and name = $2',
      [space, name],
    );
    if (!r) throw new Error(`dompet ${name} tidak ada`);
    return r.id;
  };
  const cats = await asUser<{ id: string }>(
    n.uid,
    `select id::text from app.categories
      where space_id = $1 and type = 'expense' and parent_id is null order by sort_order limit 2`,
    [n.sid],
  );
  return {
    nUid: n.uid,
    fUid: f.uid,
    bersama: n.sid,
    nPribadi: nP.sid,
    fPribadi: f.sid,
    accKas: await acc(n.uid, n.sid, BERSAMA_WALLET),
    accNBesar: await acc(n.uid, nP.sid, BESAR_WALLET),
    accNKanari: await acc(n.uid, nP.sid, 'KANARI-DOMPET-N'),
    accFKanari: await acc(f.uid, f.sid, 'KANARI-DOMPET-F'),
    catMakan: cats[0]?.id ?? '',
    catLain: cats[1]?.id ?? '',
  };
}

async function expense(
  uid: string,
  space: string,
  account: string,
  category: string,
  amount: number,
  description: string,
  daysAgo: number | null = null,
): Promise<string> {
  const [r] = await asUser<{ r: { entry_id: string } }>(
    uid,
    `select api.create_entry(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_kind => 'expense', p_amount => $4::bigint, p_category_id => $5,
       p_occurred_on => case when $6::int is null then null else app.today() - $6::int end, p_description => $7) as r`,
    [randomUUID(), space, account, amount, category, daysAgo, description],
  );
  if (!r) throw new Error('create_entry gagal');
  return r.r.entry_id;
}

async function spaceTransfer(
  uid: string,
  space: string,
  from: string,
  to: string,
  amount: number,
  note: string,
): Promise<void> {
  await asUser(
    uid,
    `select api.create_transfer(p_client_id => $1, p_space_id => $2, p_from_account => $3,
       p_to_account => $4, p_amount => $5::bigint, p_description => $6, p_shared_note => $7)`,
    [randomUUID(), space, from, to, amount, 'Catatan pribadi', note],
  );
}

// Harus pertama: tanpa fixture `kanari`, Pribadi F masih kosong (S8-O1).
test('@screens S8-O1 Beranda pertama Farida di Pribadi (kosong)', async ({
  browser,
  partnerState,
}) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ storageState: partnerState, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/pribadi/beranda');
  const cl = page.getByRole('region', { name: 'Mulai dari sini' });
  await expect(cl).toContainText('1 dari 3 selesai');
  await expect(page.getByText(/Undang/)).toHaveCount(0);
  await expect(page.getByText(/belum bergabung/)).toHaveCount(0);
  await ctx.close();
  const t8 = { dir: OUT_DIR_T8, heading: 'Beranda' };
  await shoot(
    browser,
    partnerState,
    'o1-f-pribadi-baru',
    '/pribadi/beranda',
    [...V(390, ['dark', 'light'], 2), ...V(320)],
    t8,
  );
});

test('@screens Beranda Bersama dua anggota: kosong, lalu berisi', async ({
  browser,
  ownerState,
  partnerState,
  kanari,
}) => {
  test.setTimeout(600_000);
  expect(kanari.f.wallet).toBeTruthy(); // fixture kanari: F terdaftar, Pribadi N dan F terisi

  // Dua anggota, belum ada dompet Bersama: Bersama kosong + Aktivitas kosong dua anggota.
  await shoot(browser, ownerState, 'kosong-tanpa-dompet-n', '/bersama/beranda', V(390));

  // Dibuka 30 hari lalu agar pencatatan mundur (tanggal 9 hari lalu) sah.
  const shared = await spaceOf(OWNER, 'shared');
  await asUser(
    shared.uid,
    `select api.create_account(p_client_id => $1, p_space_id => $2, p_name => $3,
       p_pocket => 'operasional', p_wallet_type => 'bank', p_opened_on => app.today() - 30,
       p_opening_balance => 5000000::bigint)`,
    [randomUUID(), shared.sid, BERSAMA_WALLET],
  );
  await createWallet(OWNER, 'personal', BESAR_WALLET, 13_000_000_000);

  // Dompet ada, belum ada peristiwa: Aktivitas kosong dengan nama anggota lain, Kontribusi nol.
  await shoot(browser, ownerState, 'kosong-n', '/bersama/beranda');
  await shoot(browser, partnerState, 'kosong-f', '/bersama/beranda', [
    ...V(390, ['dark', 'light'], 2),
    ...V(1280, ['dark']),
  ]);
  // Halaman Aktivitas kosong, dua anggota (Task 7).
  const aktivitas = { dir: OUT_DIR_AKTIVITAS, heading: 'Aktivitas' };
  await shoot(browser, ownerState, 'aktivitas-kosong-n', '/bersama/aktivitas', ALL, aktivitas);
  await shoot(
    browser,
    partnerState,
    'aktivitas-kosong-f',
    '/bersama/aktivitas',
    V(390, ['dark', 'light'], 2),
    aktivitas,
  );

  const i = await ids();
  // Peristiwa: pengeluaran kedua anggota, setoran besar N, setoran F, ambil N, ubah, batal.
  await expense(i.nUid, i.bersama, i.accKas, i.catMakan, 85_000, 'Belanja mingguan');
  await expense(
    i.fUid,
    i.bersama,
    i.accKas,
    i.catMakan,
    150_000,
    'Makan malam bersama keluarga besar di restoran dekat rumah',
  );
  await expense(i.fUid, i.bersama, i.accKas, i.catLain, 5_000, 'Parkir', 9);
  const salah = await expense(i.nUid, i.bersama, i.accKas, i.catLain, 45_000, 'Galon dan gas');
  await spaceTransfer(
    i.nUid,
    i.nPribadi,
    i.accNBesar,
    i.accKas,
    12_345_678_900,
    'Setoran bulanan rumah',
  );
  await spaceTransfer(i.fUid, i.fPribadi, i.accFKanari, i.accKas, 500_000, 'Tambahan belanja');
  await spaceTransfer(i.nUid, i.bersama, i.accKas, i.accNKanari, 250_000, 'Ambil untuk servis');
  await asUser(
    i.fUid,
    `select api.update_entry(p_client_id => $1, p_entry_id => $2, p_expected_version => 1,
         p_account_id => $3, p_amount => $4::bigint, p_category_id => $5, p_occurred_on => null,
         p_description => $6, p_reimbursable => false)`,
    [randomUUID(), salah, i.accKas, 75_000, i.catMakan, 'Galon dan gas'],
  );

  await shoot(browser, ownerState, 'berisi-n', '/bersama/beranda');
  await shoot(browser, partnerState, 'berisi-f', '/bersama/beranda', [
    ...V(390, ['dark', 'light'], 2),
    ...V(1280, ['dark', 'light']),
  ]);

  // Kontrol: tidak ada nama dompet di kartu (K1).
  const context = await browser.newContext({ storageState: ownerState, baseURL: BASE });
  try {
    const page = await context.newPage();
    await page.goto('/bersama/beranda');
    for (const name of ['Aktivitas', 'Kontribusi']) {
      const kartu = page.getByRole('region', { name: new RegExp(`^${name}`) });
      await expect(kartu).toBeVisible();
      for (const w of [BERSAMA_WALLET, BESAR_WALLET, 'KANARI']) {
        await expect(kartu).not.toContainText(w);
      }
    }
  } finally {
    await context.close();
  }
});

test('@screens Aktivitas Bersama berisi: dua hari, 30 baris, Muat sebelumnya', async ({
  browser,
  ownerState,
  partnerState,
  kanari,
}) => {
  test.setTimeout(600_000);
  expect(kanari.f.wallet).toBeTruthy();
  // Memakai dompet dan peristiwa tes sebelumnya (satu berkas, urutan tetap, satu worker).
  const i = await ids();
  const ids2: string[] = [];
  for (let n = 1; n <= 28; n++) {
    ids2.push(
      await expense(
        n % 2 === 0 ? i.fUid : i.nUid,
        i.bersama,
        i.accKas,
        n % 3 === 0 ? i.catLain : i.catMakan,
        n === 7 ? 12_345_678_900 : 10_000 * n,
        `Belanja harian ${String(n)}`,
      ),
    );
  }
  // Geser 18 peristiwa tertua ke kemarin dan 6 ke dua hari lalu agar ada beberapa kelompok hari.
  const admin = new pg.Client({ connectionString: process.env.AUTH_E2E_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(
      "update app.entry_history set changed_at = changed_at - interval '1 day' where entry_id = any($1::uuid[])",
      [ids2.slice(0, 18)],
    );
    await admin.query(
      "update app.entry_history set changed_at = changed_at - interval '2 days' where entry_id = any($1::uuid[])",
      [ids2.slice(0, 6)],
    );
    await admin.query('commit');
  } finally {
    await admin.end();
  }
  const aktivitas = { dir: OUT_DIR_AKTIVITAS, heading: 'Aktivitas' };
  await shoot(browser, ownerState, 'aktivitas-berisi-n', '/bersama/aktivitas', ALL, aktivitas);
  await shoot(
    browser,
    partnerState,
    'aktivitas-berisi-f',
    '/bersama/aktivitas',
    [...V(390, ['dark', 'light'], 2), ...V(1280, ['dark', 'light'])],
    aktivitas,
  );
  // Halaman berkursor (Kembali ke terbaru).
  const ctx = await browser.newContext({ storageState: ownerState, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/bersama/aktivitas');
  const href = await page.getByRole('link', { name: 'Muat sebelumnya' }).getAttribute('href');
  await ctx.close();
  expect(href).toContain('sebelum=');
  await shoot(browser, ownerState, 'aktivitas-halaman2-n', href ?? '', V(390), aktivitas);
});

test('@screens S8-O2 Beranda Bersama pertama bagi Farida (dompet dan entri Novanda)', async ({
  browser,
  partnerState,
  kanari,
}) => {
  test.setTimeout(300_000);
  expect(kanari.f.wallet).toBeTruthy();
  const ctx = await browser.newContext({ storageState: partnerState, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/bersama/beranda');
  await expect(page.getByRole('heading', { name: 'Beranda' }).first()).toBeVisible();
  const cl = page.getByRole('region', { name: 'Mulai dari sini' });
  if ((await cl.count()) > 0) {
    await expect(cl).toContainText(
      'Kamu dan Novanda sama-sama bisa mencatat dan mengubah di sini.',
    );
    await expect(cl).not.toContainText('Farida');
  }
  await expect(page.getByText(/belum bergabung|Undang/)).toHaveCount(0);
  await ctx.close();
  await shoot(
    browser,
    partnerState,
    'o2-f-bersama',
    '/bersama/beranda',
    [...V(390, ['dark', 'light'], 2), ...V(1280)],
    { dir: OUT_DIR_T8, heading: 'Beranda' },
  );
});

/** Biaya kaki keluar Bersama (Task 9, S8-D1a): daftar Transaksi, Terakhir, Detail; kaki Pribadi F. */
const OUT_DIR_T9 = fileURLToPath(
  new URL(
    '../../../../.superpowers/sdd/2026-11-04-dompetku-v2-s8-bersama/task-9-screens/',
    import.meta.url,
  ),
);

test('@screens S8-D1a biaya kaki keluar Bersama (F mengambil, biaya 2.500)', async ({
  browser,
  ownerState,
  partnerState,
  kanari,
}) => {
  test.setTimeout(600_000);
  expect(kanari.f.wallet).toBeTruthy();
  const i = await ids();
  // F mengambil dari Kas Rumah ke dompet Pribadinya dengan biaya 2.500 (kaki keluar = Bersama).
  await asUser(
    i.fUid,
    `select api.create_transfer(p_client_id => $1, p_space_id => $2, p_from_account => $3,
       p_to_account => $4, p_amount => $5::bigint, p_fee => 2500::bigint,
       p_description => $6, p_shared_note => $7)`,
    [randomUUID(), i.bersama, i.accKas, i.accFKanari, 100_000, 'Catatan pribadi F', 'Ambil biaya'],
  );
  const [leg] = await asUser<{ id: string; sid: string }>(
    i.fUid,
    `select e.id::text, e.space_id::text as sid from app.entries e
      where e.kind = 'space_transfer' and e.direction = 'out' and e.space_id = $1
      order by e.created_at desc limit 1`,
    [i.bersama],
  );
  const [pLeg] = await asUser<{ id: string }>(
    i.fUid,
    `select e.id::text from app.entries e
      where e.kind = 'space_transfer' and e.direction = 'in' and e.space_id = $1
      order by e.created_at desc limit 1`,
    [i.fPribadi],
  );
  if (!leg || !pLeg) throw new Error('kaki transfer tidak ada');
  const rp = (n: string) => new RegExp(`Rp\\s*${n.replace('.', '\\.')}`);

  for (const state of [ownerState, partnerState]) {
    const ctx = await browser.newContext({ storageState: state, baseURL: BASE });
    const page = await ctx.newPage();
    // Daftar Transaksi dan Terakhir: status ketiga, nominal kanan tetap nominal transfer.
    for (const path of ['/bersama/transaksi', '/bersama/beranda']) {
      await page.goto(path);
      const row = page.locator('li', { hasText: `Diambil oleh Farida` }).first();
      await expect(row).toContainText('Antar ruang');
      await expect(row).toContainText(rp('2.500'));
      await expect(row).toContainText(/Biaya/);
      await expect(row).toContainText(rp('100.000'));
      await expect(row).not.toContainText('KANARI');
    }
    await page.goto(`/bersama/transaksi/${leg.id}`);
    await expect(page.getByText('Biaya', { exact: true })).toBeVisible();
    await expect(page.locator('main')).not.toContainText('KANARI');
    await expect(page.locator('main')).not.toContainText('Catatan pribadi F');
    await ctx.close();
  }
  const t9 = { dir: OUT_DIR_T9, heading: '' };
  await shoot(browser, ownerState, 'transaksi-n', '/bersama/transaksi', V(390), {
    ...t9,
    heading: 'Transaksi',
  });
  await shoot(browser, ownerState, 'beranda-n', '/bersama/beranda', [...V(390), ...V(320)], {
    ...t9,
    heading: 'Beranda',
  });
  // Detail kaki keluar Bersama: tangkapan viewport, digulir sampai baris Biaya terlihat.
  await mkdir(OUT_DIR_T9, { recursive: true });
  for (const v of [...V(320), ...V(390, ['dark', 'light'], 2)]) {
    const c = await browser.newContext({
      storageState: partnerState,
      viewport: { width: v.w, height: v.h },
      deviceScaleFactor: v.dpr,
      reducedMotion: 'reduce',
      baseURL: BASE,
    });
    try {
      const pg2 = await c.newPage();
      await pg2.goto(`/bersama/transaksi/${leg.id}?theme=${v.theme}`);
      await expect(pg2.locator('html')).toHaveAttribute('data-theme', v.theme);
      const biaya = pg2.getByText('Biaya', { exact: true });
      await expect(biaya).toBeVisible();
      await biaya.evaluate((el) => {
        el.scrollIntoView({ block: 'center' });
      });
      await settle(pg2);
      await expect(biaya).toBeInViewport();
      await pg2.screenshot({
        path: `${OUT_DIR_T9}detail-bersama-biaya-${String(v.w)}-${v.theme}.png`,
        animations: 'disabled',
      });
    } finally {
      await c.close();
    }
  }
  // Anggaran JS mode nyata (rute-kB di konsol dan anotasi).
  for (const [name, url] of [
    ['beranda', '/bersama/beranda'],
    ['transaksi', '/bersama/transaksi'],
    ['detail', `/bersama/transaksi/${leg.id}`],
    ['aktivitas', '/bersama/aktivitas'],
  ] as const) {
    const kb = await expectRouteBudget(browser, ownerState, url);
    console.log(`BUDGET-NYATA ${name}: js-route ${kb.toFixed(1)} kB`);
  }
  // Kaki Pribadi F: tidak ada baris Biaya dan tidak ada penunjuk ke kaki Bersama.
  const ctx = await browser.newContext({ storageState: partnerState, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto(`/pribadi/transaksi/${pLeg.id}`);
  await expect(page.getByRole('heading', { name: 'Ambil dari Bersama' }).first()).toBeVisible();
  await expect(page.getByText('Biaya', { exact: true })).toHaveCount(0);
  await ctx.close();
  await shoot(
    browser,
    partnerState,
    'detail-pribadi-f',
    `/pribadi/transaksi/${pLeg.id}`,
    V(390, ['dark', 'light']),
    { ...t9, heading: 'Ambil dari Bersama' },
  );
});

/**
 * Kriteria keluar S8 (Task 10): layar portofolio dua anggota ke `docs/design/s8/`. Harus terakhir:
 * data ledger tes sebelumnya (nominal tekanan `Rp 12.345.678.900`, nama dompet kanari) dibuang
 * dulu (akun, ruang, kategori tetap), lalu diisi cerita realistis lewat fungsi `api.*`.
 */
const OUT_DIR_DOCS = fileURLToPath(new URL('../../../../docs/design/s8/', import.meta.url));

async function wipeLedger(): Promise<void> {
  const admin = new pg.Client({ connectionString: process.env.AUTH_E2E_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`
    begin;
    select set_config('dompetku.purge', 'on', true);
    delete from app.product_events;
    delete from app.idempotency_keys;
    delete from app.entry_lines;
    delete from app.entry_history;
    delete from app.entries;
    delete from app.entry_tombstones;
    delete from app.accounts;
    delete from app.no_spend_days;
    commit;`);
  } finally {
    await admin.end();
  }
}

/**
 * Waktu peristiwa fixture: semua baris baru dibuat dalam satu menit, jadi feed menampilkan satu
 * jam yang sama. Sebar urut kausal (dibuat sebelum diubah) ke kemarin dan hari ini (WIB) dengan
 * jam yang wajar. Hanya `changed_at` (trigger dimatikan lewat replica); nilai uang tidak disentuh.
 */
async function spreadEventTimes(): Promise<void> {
  const admin = new pg.Client({ connectionString: process.env.AUTH_E2E_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    const { rows } = await admin.query<{ entry_id: string; version: number }>(
      "select entry_id::text, version from app.entry_history where snapshot->>'kind' <> 'opening_balance' order by changed_at, entry_id, version",
    );
    const kemarin = [8 * 60 + 12, 12 * 60 + 40, 19 * 60 + 4, 20 * 60 + 31];
    // Saldo awal tidak muncul di feed dan tidak ikut disebar.
    const hariIni = [
      6 * 60 + 18,
      7 * 60 + 52,
      9 * 60 + 5,
      10 * 60 + 47,
      11 * 60 + 26,
      12 * 60 + 40,
    ];
    const nKemarin = Math.min(kemarin.length, Math.floor(rows.length / 2));
    for (const [idx, r] of rows.entries()) {
      const menit =
        idx < nKemarin
          ? kemarin[idx]
          : (hariIni[idx - nKemarin] ?? (hariIni.at(-1) ?? 0) + (idx - nKemarin) * 9);
      const dayOffset = idx < nKemarin ? 1 : 0;
      await admin.query(
        `update app.entry_history
            set changed_at = ((app.today() - $3::int)::timestamp + make_interval(mins => $4::int))
                             at time zone 'Asia/Jakarta'
          where entry_id = $1::uuid and version = $2`,
        [r.entry_id, r.version, dayOffset, menit],
      );
    }
    // Entri yang peristiwanya dipindah ke kemarin ikut bertanggal kemarin; tanpa ini feed menulis
    // `tanggal <hari ini>` (tanggal mundur palsu) di baris Kemarin.
    const kemarinIds = [...new Set(rows.slice(0, nKemarin).map((r) => r.entry_id))];
    await admin.query(
      'update app.entries set occurred_on = app.today() - 1 where id = any($1::uuid[]) and occurred_on = app.today()',
      [kemarinIds],
    );
    await admin.query(
      `update app.entry_history
          set snapshot = jsonb_set(snapshot, '{occurred_on}', to_jsonb((app.today() - 1)::text))
        where entry_id = any($1::uuid[]) and snapshot->>'occurred_on' = app.today()::text`,
      [kemarinIds],
    );
    await admin.query('commit');
  } finally {
    await admin.end();
  }
}

test('@screens S8 kriteria keluar: Beranda, Aktivitas, Detail dua anggota (docs/design/s8)', async ({
  browser,
  ownerState,
  partnerState,
  kanari,
}) => {
  test.setTimeout(600_000);
  expect(kanari.f.wallet).toBeTruthy();
  await wipeLedger();
  const n = await spaceOf(OWNER, 'shared');
  const nP = await spaceOf(OWNER, 'personal');
  const fP = await spaceOf(PARTNER, 'personal');
  await asUser(
    n.uid,
    `select api.create_account(p_client_id => $1, p_space_id => $2, p_name => $3,
       p_pocket => 'operasional', p_wallet_type => 'bank', p_opened_on => app.today() - 30,
       p_opening_balance => 3000000::bigint)`,
    [randomUUID(), n.sid, BERSAMA_WALLET],
  );
  await createWallet(OWNER, 'personal', 'BCA Novanda', 8_000_000);
  await createWallet(PARTNER, 'personal', 'Jago Farida', 5_000_000);
  const acc = async (uid: string, space: string, name: string) => {
    const [r] = await asUser<{ id: string }>(
      uid,
      'select id::text from app.accounts where space_id = $1 and name = $2',
      [space, name],
    );
    if (!r) throw new Error(`dompet ${name} tidak ada`);
    return r.id;
  };
  const kas = await acc(n.uid, n.sid, BERSAMA_WALLET);
  const bca = await acc(nP.uid, nP.sid, 'BCA Novanda');
  const jago = await acc(fP.uid, fP.sid, 'Jago Farida');
  // Kategori bawaan Bersama yang cocok dengan keterangan (layar portofolio).
  const cat = async (name: string) => {
    const [r] = await asUser<{ id: string }>(
      n.uid,
      `select id::text from app.categories
        where space_id = $1 and type = 'expense' and parent_id is null and name = $2`,
      [n.sid, name],
    );
    if (!r) throw new Error(`kategori ${name} tidak ada`);
    return r.id;
  };
  const dapur = await cat('Belanja Dapur');
  const makanLuar = await cat('Makan di Luar');
  const parkir = await cat('Bensin & Parkir');
  const listrik = await cat('Listrik & Air');
  const [catP] = await asUser<{ id: string }>(
    nP.uid,
    `select id::text from app.categories
      where space_id = $1 and type = 'expense' and parent_id is null order by sort_order limit 1`,
    [nP.sid],
  );

  await spaceTransfer(n.uid, nP.sid, bca, kas, 2_000_000, 'Belanja bulanan');
  await spaceTransfer(fP.uid, fP.sid, jago, kas, 1_500_000, 'Tambahan dapur');
  await expense(n.uid, n.sid, kas, dapur, 285_000, 'Belanja mingguan');
  await expense(fP.uid, n.sid, kas, parkir, 5_000, 'Parkir', 2);
  const galon = await expense(n.uid, n.sid, kas, listrik, 45_000, 'Galon dan gas');
  await asUser(
    fP.uid,
    `select api.update_entry(p_client_id => $1, p_entry_id => $2, p_expected_version => 1,
       p_account_id => $3, p_amount => 60000::bigint, p_category_id => $4, p_occurred_on => null,
       p_description => 'Galon dan gas', p_reimbursable => false)`,
    [randomUUID(), galon, kas, listrik],
  );
  await expense(fP.uid, n.sid, kas, makanLuar, 150_000, 'Makan malam');
  await asUser(
    fP.uid,
    `select api.create_transfer(p_client_id => $1, p_space_id => $2, p_from_account => $3,
       p_to_account => $4, p_amount => 200000::bigint, p_description => 'Ongkos pribadi',
       p_shared_note => 'Ganti ongkos')`,
    [randomUUID(), n.sid, kas, jago],
  );
  const sabun = await expense(n.uid, n.sid, kas, dapur, 32_000, 'Sabun cuci');
  await asUser(
    n.uid,
    `select api.move_entry_to_space(p_client_id => $1, p_entry_id => $2, p_expected_version => 1,
       p_to_space_id => $3, p_account_id => $4, p_category_id => $5)`,
    [randomUUID(), sabun, nP.sid, bca, catP?.id ?? ''],
  );
  await spreadEventTimes();
  const [setoran] = await asUser<{ id: string }>(
    n.uid,
    `select id::text from app.entries where space_id = $1 and kind = 'space_transfer'
       and direction = 'in' and created_by = $2 limit 1`,
    [n.sid, n.uid],
  );
  if (!setoran) throw new Error('setoran tidak ada');

  const docs = (heading: string) => ({ dir: OUT_DIR_DOCS, heading });
  // Beranda dan Aktivitas F identis byte dengan milik N (nama, bukan "kamu"; Kontribusi pemilik dulu
  // bagi kedua pembaca), jadi F hanya dipotret di layar yang berbeda (Detail B5 dan D2).
  await shoot(browser, ownerState, 'a1-beranda-n', '/bersama/beranda', ALL, docs('Beranda'));
  await shoot(
    browser,
    ownerState,
    'a3-aktivitas-n',
    '/bersama/aktivitas',
    [...V(390, ['dark', 'light'], 2), ...V(1280, ['dark'])],
    docs('Aktivitas'),
  );
  await shoot(
    browser,
    partnerState,
    'b5-setoran-n-dilihat-f',
    `/bersama/transaksi/${setoran.id}`,
    V(390, ['dark', 'light'], 2),
    docs('Setoran dari Novanda'),
  );
  await shoot(
    browser,
    partnerState,
    'd2-dipindah-dilihat-f',
    `/bersama/transaksi/${sabun}`,
    V(390, ['dark', 'light'], 2),
    docs('Sabun cuci'),
  );
  // Layar yang dipotret: tanpa kanari, nominal tekanan, atau nama dompet di feed (K1).
  const ctx = await browser.newContext({ storageState: partnerState, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/bersama/beranda');
  for (const name of ['Aktivitas', 'Kontribusi']) {
    const kartu = page.getByRole('region', { name: new RegExp(`^${name}`) });
    for (const w of [BERSAMA_WALLET, 'BCA Novanda', 'Jago Farida', 'KANARI', '12.345.678.900']) {
      await expect(kartu).not.toContainText(w);
    }
  }
  await expect(page.getByRole('main')).not.toContainText('12.345.678.900');
  await ctx.close();
});
