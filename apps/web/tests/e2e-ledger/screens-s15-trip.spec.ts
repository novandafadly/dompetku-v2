import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import type { Browser, Page } from '@playwright/test';
import { asUser, spaceOf } from '../e2e-auth/helpers';
import { adminQuery, expect, OWNER, test } from './fixtures';
import { expectRouteBudget, openCatat } from './helpers';
import { BASE, openUntil, THEMES, WIDTHS } from './s14-shots';

/**
 * Screenshot S15 Task 12 (Menu Trip, daftar Trip, Detail trip semua keadaan, sheet Tambah/Ubah/
 * Masukkan, dialog Arsipkan, Catat saran & Pilih trip, Detail transaksi baris Trip) mode nyata
 * untuk Delivery Gate, plus ukuran budget JS rute.
 * Dilewati kecuali `SHOTS_DIR` diisi. Jalankan sendiri pada DB bersih:
 * `SHOTS_DIR=/tmp/shots-s15 playwright test -c playwright.ledger.config.ts screens-s15-trip --project=kosong`
 */
const DIR = process.env.SHOTS_DIR;
test.skip(DIR === undefined, 'screenshot hanya dengan SHOTS_DIR');
test.describe.configure({ mode: 'serial' });
test.setTimeout(1_200_000);

const OUT = DIR ?? '';
const main = (page: Page) => page.getByRole('main');

let uid = '';
let sid = '';
const ids: Record<string, string> = {};
const id = (k: string): string => ids[k] ?? '';

async function api<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return asUser<T>(uid, sql, params);
}

async function auditS15(page: Page, name: string, w: number, theme: string) {
  return page.evaluate(
    ({ name: n, w: width, theme: th }) => {
      const roots = [...document.querySelectorAll('main, [role="dialog"], [role="alertdialog"]')];
      const scan = roots.length > 0 ? roots : [document.body];
      const text = scan.map((el) => (el as HTMLElement).innerText).join('\n');
      const banned = [
        ...text.matchAll(
          /\b(?:boncos|surplus|budget|liburan|hutang)\b|rumah tangga|!|\p{Extended_Pictographic}/giu,
        ),
      ].map((m) => m[0]);
      const rpZero = [...text.matchAll(/.{0,30}Rp\s?0(?![\d.])(?!\s?\/).{0,20}/g)].map((m) => m[0]);
      return {
        name: n,
        w: width,
        theme: th,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        banned,
        rpZero,
      };
    },
    { name, w, theme },
  );
}

async function shoot(
  browser: Browser,
  state: string,
  name: string,
  path: string,
  act?: (p: Page) => Promise<void>,
  opts: { viewport?: boolean } = {},
) {
  for (const theme of THEMES) {
    for (const w of WIDTHS) {
      const h = w === 1280 ? 800 : w === 320 ? 640 : 844;
      const context = await browser.newContext({
        storageState: state,
        viewport: { width: w, height: h },
        reducedMotion: 'reduce',
        baseURL: BASE,
      });
      const page = await context.newPage();
      try {
        await page.goto(`${path}${path.includes('?') ? '&' : '?'}theme=${theme}`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        if (act) await act(page);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const audit = await auditS15(page, name, w, theme);
        await appendFile(`${OUT}/_audit.jsonl`, `${JSON.stringify(audit)}\n`);
        if (opts.viewport !== true) {
          await page.evaluate(() => {
            document.querySelectorAll<HTMLElement>('nav[aria-label="Tab utama"]').forEach((el) => {
              el.style.display = 'none';
            });
          });
          if (w === 1280) {
            const dh = await page.evaluate(() => document.documentElement.scrollHeight);
            await page.setViewportSize({ width: w, height: Math.min(Math.max(h, dh), 3400) });
            await page.waitForTimeout(200);
          }
        }
        await page.screenshot({
          path: `${OUT}/${name}-${String(w)}-${theme}.png`,
          fullPage: opts.viewport !== true,
          animations: 'disabled',
        });
      } catch (e) {
        await appendFile(
          `${OUT}/_failures.txt`,
          `${name}-${String(w)}-${theme}: ${String(e).split('\n')[0] ?? ''}\n`,
        );
      } finally {
        await context.close();
      }
    }
  }
}

test('data dan screenshot S15 Trip (daftar, detail, sheet, Catat, Detail transaksi)', async ({
  browser,
  ownerState,
}) => {
  await mkdir(OUT, { recursive: true });
  ({ uid, sid } = await spaceOf(OWNER, 'personal'));

  // 1. Daftar kosong + Menu Trip
  await shoot(browser, ownerState, 'tr-daftar-kosong', '/pribadi/trip');
  await shoot(
    browser,
    ownerState,
    'tr-menu',
    '/pribadi/beranda',
    async (p) => {
      const btn = p.getByRole('button', { name: 'Menu', exact: true });
      const dlg = p.getByRole('dialog', { name: 'Menu', exact: true });
      await openUntil(() => btn, dlg);
    },
    { viewport: true },
  );

  // Buat dompet & kategori
  await api(
    `select api.create_account(p_client_id => $1, p_space_id => $2, p_name => 'BCA Utama',
       p_pocket => 'operasional'::app.pocket, p_wallet_type => 'bank',
       p_opened_on => app.today() - 30, p_opening_balance => 50000000000::bigint)`,
    [randomUUID(), sid],
  );
  const [bca] = await adminQuery<{ id: string }>(
    `select id::text from app.accounts where space_id = $1 and name = 'BCA Utama'`,
    [sid],
  );
  const cats = await adminQuery<{ id: string }>(
    `select id::text from app.categories where space_id = $1 and type = 'expense' and archived_at is null order by sort_order, name limit 2`,
    [sid],
  );
  const makan = cats[0];
  const trans = cats[1] ?? cats[0];
  if (!bca || !makan || !trans) throw new Error('seed bca/kategori gagal');

  // Trip 1: Berlangsung (normal, anggaran 45%, kandidat 2, 1 entri di luar rentang)
  const [t1] = await api<{ r: { trip_id: string } }>(
    `select api.create_trip($1, $2, 'Bali, Desember 2026', app.today() - 2, app.today() + 3, 5000000::bigint) as r`,
    [randomUUID(), sid],
  );
  // Trip 2: Akan datang (kosong)
  const [t2] = await api<{ r: { trip_id: string } }>(
    `select api.create_trip($1, $2, 'Yogyakarta Tahun Baru', app.today() + 10, app.today() + 14, 3000000::bigint) as r`,
    [randomUUID(), sid],
  );
  // Trip 3: Selesai + nama 60 huruf + nominal 12,34 M + kelebihan anggaran
  const longName = 'Perjalanan Dinas Surabaya Malang Banyuwangi Akhir Tahun 2026';
  const [t3] = await api<{ r: { trip_id: string } }>(
    `select api.create_trip($1, $2, $3, app.today() - 15, app.today() - 10, 10000000000::bigint) as r`,
    [randomUUID(), sid, longName],
  );
  // Trip 4: Diarsipkan
  const [t4] = await api<{ r: { trip_id: string } }>(
    `select api.create_trip($1, $2, 'Bandung Oktober', app.today() - 40, app.today() - 38, null) as r`,
    [randomUUID(), sid],
  );
  if (!t1 || !t2 || !t3 || !t4) throw new Error('buat trip gagal');
  ids.bali = t1.r.trip_id;
  ids.jogja = t2.r.trip_id;
  ids.panjang = t3.r.trip_id;
  ids.arsip = t4.r.trip_id;
  await api(`select api.archive_trip($1)`, [id('arsip')]);

  // Isi pengeluaran Trip 1 (dalam rentang + 1 di luar rentang) + 2 kandidat belum masuk
  const [e1] = await api<{ r: { entry_id: string } }>(
    `select api.create_entry(
       p_client_id => $1, p_space_id => $2, p_kind => 'expense'::app.entry_kind,
       p_amount => 1250000::bigint, p_occurred_on => app.today(),
       p_account_id => $3, p_category_id => $4, p_description => 'Tiket pesawat dan bagasi',
       p_trip_id => $5) as r`,
    [randomUUID(), sid, bca.id, trans.id, id('bali')],
  );
  await api(
    `select api.create_entry(
       p_client_id => $1, p_space_id => $2, p_kind => 'expense'::app.entry_kind,
       p_amount => 650000::bigint, p_occurred_on => app.today() - 1,
       p_account_id => $3, p_category_id => $4, p_description => 'Makan malam Jimbaran',
       p_trip_id => $5)`,
    [randomUUID(), sid, bca.id, makan.id, id('bali')],
  );
  await api(
    `select api.create_entry(
       p_client_id => $1, p_space_id => $2, p_kind => 'expense'::app.entry_kind,
       p_amount => 350000::bigint, p_occurred_on => app.today() - 10,
       p_account_id => $3, p_category_id => $4, p_description => 'DP sewa mobil sebelum berangkat',
       p_trip_id => $5)`,
    [randomUUID(), sid, bca.id, trans.id, id('bali')],
  );
  // 2 kandidat di rentang Trip 1
  await api(
    `select api.create_entry(
       p_client_id => $1, p_space_id => $2, p_kind => 'expense'::app.entry_kind,
       p_amount => 85000::bigint, p_occurred_on => app.today(),
       p_account_id => $3, p_category_id => $4, p_description => 'Kopi bandara')`,
    [randomUUID(), sid, bca.id, makan.id],
  );
  await api(
    `select api.create_entry(
       p_client_id => $1, p_space_id => $2, p_kind => 'expense'::app.entry_kind,
       p_amount => 120000::bigint, p_occurred_on => app.today() - 1,
       p_account_id => $3, p_category_id => $4, p_description => 'Bensin hari pertama')`,
    [randomUUID(), sid, bca.id, trans.id],
  );
  // Pengeluaran Rp 12.345.678.900 di Trip 3 (lebih anggaran)
  await api(
    `select api.create_entry(
       p_client_id => $1, p_space_id => $2, p_kind => 'expense'::app.entry_kind,
       p_amount => 12345678900::bigint, p_occurred_on => app.today() - 12,
       p_account_id => $3, p_category_id => $4, p_description => 'Akomodasi dan logistik rombongan besar',
       p_trip_id => $5)`,
    [randomUUID(), sid, bca.id, trans.id, id('panjang')],
  );
  if (!e1) throw new Error('entri e1 gagal');
  ids.e1 = e1.r.entry_id;

  // 2. Daftar Trip (tiga grup + terarsip terbuka)
  await shoot(browser, ownerState, 'tr-daftar-grup', '/pribadi/trip');
  await shoot(browser, ownerState, 'tr-daftar-arsip', '/pribadi/trip', async (p) => {
    await main(p).getByText('Trip diarsipkan (1)').click();
  });

  // 3. Detail Trip: normal (Per hari dibuka), kosong, lebih + nama panjang + 12,34M, terarsip
  await shoot(browser, ownerState, 'tr-detail-normal', `/pribadi/trip/${id('bali')}`, async (p) => {
    await main(p)
      .getByText(/^Per hari/)
      .click();
  });
  await shoot(browser, ownerState, 'tr-detail-kosong', `/pribadi/trip/${id('jogja')}`);
  await shoot(browser, ownerState, 'tr-detail-lebih', `/pribadi/trip/${id('panjang')}`);
  await shoot(browser, ownerState, 'tr-detail-arsip', `/pribadi/trip/${id('arsip')}`);

  // 4. Sheet Tambah (galat klien), Ubah, Masukkan, Dialog Arsipkan
  await shoot(
    browser,
    ownerState,
    'tr-sheet-tambah',
    '/pribadi/trip',
    async (p) => {
      const dlg = p.getByRole('dialog', { name: /^Tambah trip/ });
      await openUntil(() => main(p).getByRole('button', { name: 'Tambah trip' }), dlg);
      await dlg.getByRole('button', { name: 'Simpan trip' }).click();
    },
    { viewport: true },
  );
  await shoot(
    browser,
    ownerState,
    'tr-sheet-ubah',
    `/pribadi/trip/${id('bali')}`,
    async (p) => {
      const dlg = p.getByRole('dialog', { name: /^Ubah trip/ });
      await openUntil(() => main(p).getByRole('button', { name: 'Ubah trip' }), dlg);
    },
    { viewport: true },
  );
  await shoot(
    browser,
    ownerState,
    'tr-sheet-masukkan',
    `/pribadi/trip/${id('bali')}`,
    async (p) => {
      const dlg = p.getByRole('dialog', { name: /Masukkan ke Bali/ });
      await openUntil(() => main(p).getByRole('button', { name: /Masukkan 2 pengeluaran/ }), dlg);
    },
    { viewport: true },
  );
  await shoot(
    browser,
    ownerState,
    'tr-dialog-arsip',
    `/pribadi/trip/${id('bali')}`,
    async (p) => {
      const dlg = p.getByRole('alertdialog', { name: /Arsipkan Bali/ });
      await openUntil(() => main(p).getByRole('button', { name: 'Arsipkan' }), dlg);
    },
    { viewport: true },
  );

  // 5. Catat: saran otomatis & Pilih trip
  await shoot(
    browser,
    ownerState,
    'tr-catat-saran',
    '/pribadi/beranda',
    async (p) => {
      await openCatat(p);
    },
    { viewport: true },
  );
  await shoot(
    browser,
    ownerState,
    'tr-catat-pilih',
    '/pribadi/beranda',
    async (p) => {
      const sheet = await openCatat(p);
      await sheet.getByRole('button', { name: /Trip Bali, Desember 2026, ganti/ }).click();
      await expect(
        p.getByRole('dialog').getByRole('radiogroup', { name: 'Pilih trip' }),
      ).toBeVisible();
    },
    { viewport: true },
  );

  // 6. Detail transaksi dengan baris Trip
  await shoot(browser, ownerState, 'tr-detail-transaksi', `/pribadi/transaksi/${id('e1')}`);
});

test('budget JS rute Trip dan rute terdampak', async ({ browser, ownerState }) => {
  const tripList = await expectRouteBudget(browser, ownerState, '/pribadi/trip');
  const tripDetail = await expectRouteBudget(browser, ownerState, `/pribadi/trip/${id('bali')}`);
  const beranda = await expectRouteBudget(browser, ownerState, '/pribadi/beranda');
  const transaksi = await expectRouteBudget(browser, ownerState, '/pribadi/transaksi');
  const detail = await expectRouteBudget(browser, ownerState, `/pribadi/transaksi/${id('e1')}`);
  console.log(
    `BUDGET_S15 trip=${tripList.toFixed(1)} trip-detail=${tripDetail.toFixed(1)} beranda=${beranda.toFixed(1)} transaksi=${transaksi.toFixed(1)} detail=${detail.toFixed(1)}`,
  );
});
