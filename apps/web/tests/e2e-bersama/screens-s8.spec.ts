import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Browser, Page } from '@playwright/test';
import { asUser, createWallet, spaceOf } from '../e2e-auth/helpers';
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
  const page = await (
    await browser.newContext({ storageState: ownerState, baseURL: BASE })
  ).newPage();
  await page.goto('/bersama/beranda');
  for (const name of ['Aktivitas', 'Kontribusi']) {
    const kartu = page.getByRole('region', { name: new RegExp(`^${name}`) });
    await expect(kartu).toBeVisible();
    for (const w of [BERSAMA_WALLET, BESAR_WALLET, 'KANARI']) {
      await expect(kartu).not.toContainText(w);
    }
  }
  await page.context().close();
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
