import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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

async function shoot(browser: Browser, state: string, name: string, path: string, shots = ALL) {
  await mkdir(OUT_DIR, { recursive: true });
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
      await expect(page.getByRole('heading', { name: 'Beranda' }).first()).toBeVisible();
      await settle(page);
      await page.screenshot({
        path: `${OUT_DIR}${name}-${String(v.w)}-${v.theme}.png`,
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
