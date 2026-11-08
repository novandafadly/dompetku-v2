import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from '@playwright/test';
import { asUser, spaceOf } from '../e2e-auth/helpers';
import { adminQuery, expect, OWNER, test } from './fixtures';

/**
 * Screenshot Laporan mode nyata (S9 Task 13, S9-LP1..LP13) untuk design reviewer dan portofolio.
 * Bukan tes regresi: dilewati kecuali `SCREENS=1`. Jalankan sendiri (data kosong dari global-setup):
 * `SCREENS=1 playwright test -c playwright.ledger.config.ts --project=kosong screens-s9-laporan`.
 * Data diisi lewat `api.*` sebagai pemilik (dicatat mundur), nominal wajar; LP12 (angka panjang)
 * dipotret paling akhir karena menambah satu pengeluaran Rp 12.345.678.900. LP6 (memuat) dan LP7
 * (galat) tidak bisa dipicu dari e2e tanpa merusak server: dibahas lewat unit test dan bingkai.
 * Viewport disetel setinggi dokumen (bukan fullPage) seperti screenshot Beranda.
 */
test.skip(process.env.SCREENS !== '1', 'screenshot hanya dengan SCREENS=1');
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const OUT_DIR = fileURLToPath(new URL('../../../../docs/design/s9/', import.meta.url));
const WIDTHS = [320, 390, 768, 1280];
const THEMES = ['dark', 'light'] as const;

async function shoot(
  browser: Browser,
  ownerState: string,
  path: string,
  name: string,
  opts: {
    widths?: number[];
    themes?: readonly ('dark' | 'light')[];
    ready?: (p: Page) => Promise<void>;
  } = {},
) {
  for (const theme of opts.themes ?? THEMES) {
    for (const w of opts.widths ?? WIDTHS) {
      const context = await browser.newContext({
        storageState: ownerState,
        viewport: { width: w, height: w === 1280 ? 800 : w === 768 ? 1000 : w === 320 ? 640 : 844 },
        reducedMotion: 'reduce',
        baseURL: 'http://localhost:3301',
      });
      const page = await context.newPage();
      try {
        await page.goto(`${path}${path.includes('?') ? '&' : '?'}theme=${theme}`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('main')).toBeVisible();
        if (opts.ready) await opts.ready(page);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        for (let i = 0; i < 2; i += 1) {
          const h = await page.evaluate(() => document.documentElement.scrollHeight);
          await page.setViewportSize({ width: w, height: h });
          await page.waitForTimeout(250);
        }
        await page.screenshot({
          path: `${OUT_DIR}${name}-${String(w)}-${theme}.png`,
          animations: 'disabled',
        });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (overflow > 0)
          console.log(`OVERFLOW ${name} ${String(w)} ${theme}: +${String(overflow)}px`);
      } finally {
        await context.close();
      }
    }
  }
}

interface Seed {
  kind: 'personal' | 'shared';
  wallet: string;
  wallet2?: string;
  opening: number;
}

async function seed(
  s: Seed,
  rows: { cat: string | null; amount: number; on: string; kind?: 'expense' | 'income' }[],
  transfers: { amount: number; on: string }[] = [],
) {
  const { uid, sid } = await spaceOf(OWNER, s.kind);
  const [d] = await adminQuery<{ p1: string; p2: string; p3: string }>(
    `select to_char((select starts_on from app.period_of_label($1, (q.l - interval '3 month')::date)), 'YYYY-MM-DD') as p3,
            '' as p1, '' as p2
       from (select label_month as l from app.pay_period($1, app.today())) q`,
    [sid],
  );
  const create = (name: string, opening: number) =>
    asUser(
      uid,
      `select api.create_account(p_client_id => $1, p_space_id => $2, p_name => $3, p_pocket => 'operasional',
         p_wallet_type => 'bank', p_opened_on => $4::date, p_opening_balance => $5::bigint)`,
      [randomUUID(), sid, name, d?.p3, opening],
    );
  await create(s.wallet, s.opening);
  if (s.wallet2) await create(s.wallet2, 0);
  const [ids] = await asUser<{ a: string; b: string | null }>(
    uid,
    `select (select id from app.accounts where space_id = $1 and name = $2) as a,
            (select id from app.accounts where space_id = $1 and name = $3) as b`,
    [sid, s.wallet, s.wallet2 ?? ''],
  );
  if (!ids) throw new Error('dompet');
  for (const r of rows) {
    const kind = r.kind ?? 'expense';
    await asUser(
      uid,
      `select api.create_entry(p_client_id => $1, p_space_id => $2, p_account_id => $3, p_kind => $4::app.entry_kind,
         p_amount => $5::bigint, p_category_id => (select id from app.categories where space_id = $2 and name = $6
           and type = $7::app.category_type), p_occurred_on => $8::date)`,
      [randomUUID(), sid, ids.a, kind, r.amount, r.cat ?? '', kind, r.on],
    );
  }
  for (const t of transfers) {
    if (!ids.b) throw new Error('dompet tujuan');
    await asUser(
      uid,
      `select api.create_transfer(p_client_id => $1, p_space_id => $2, p_from_account => $3, p_to_account => $4,
         p_amount => $5::bigint, p_occurred_on => $6::date)`,
      [randomUUID(), sid, ids.a, ids.b, t.amount, t.on],
    );
  }
}

/** Tanggal di tiga periode lalu (mid-awal periode) dan hari ini, dari SQL. */
async function dates(kind: 'personal' | 'shared') {
  const sid = (await spaceOf(OWNER, kind)).sid;
  const [r] = await adminQuery<{ t: string; p1: string; p2: string; p3: string }>(
    `select to_char(app.today(), 'YYYY-MM-DD') as t,
            to_char((select starts_on from app.period_of_label($1, (q.l - interval '1 month')::date)) + 3, 'YYYY-MM-DD') as p1,
            to_char((select starts_on from app.period_of_label($1, (q.l - interval '2 month')::date)) + 3, 'YYYY-MM-DD') as p2,
            to_char((select starts_on from app.period_of_label($1, (q.l - interval '3 month')::date)) + 3, 'YYYY-MM-DD') as p3
       from (select label_month as l from app.pay_period($1, app.today())) q`,
    [sid],
  );
  if (!r) throw new Error('dates');
  return r;
}

test('isi data wajar Pribadi dan Bersama', async () => {
  const d = await dates('personal');
  await seed(
    { kind: 'personal', wallet: 'BCA Utama', wallet2: 'Dompet Tunai', opening: 12_000_000 },
    [
      { cat: 'Gaji', amount: 6_500_000, on: d.p3, kind: 'income' },
      { cat: 'Gaji', amount: 6_800_000, on: d.p2, kind: 'income' },
      { cat: 'Gaji', amount: 7_100_000, on: d.p1, kind: 'income' },
      { cat: 'Gaji', amount: 6_500_000, on: d.t, kind: 'income' },
      { cat: 'Makan Siang & Minum', amount: 1_450_000, on: d.p3 },
      { cat: 'Makan Siang & Minum', amount: 2_320_000, on: d.p2 },
      { cat: 'Hiburan', amount: 880_000, on: d.p2 },
      { cat: 'Makan Siang & Minum', amount: 1_610_000, on: d.p1 },
      { cat: 'Belanja', amount: 1_450_000, on: d.p1 },
      { cat: 'Transportasi', amount: 640_000, on: d.p1 },
      { cat: 'Langganan', amount: 153_000, on: d.p1 },
      { cat: 'Makan Siang & Minum', amount: 980_000, on: d.t },
      { cat: 'Kopi & Camilan', amount: 345_000, on: d.t },
      { cat: 'Transportasi', amount: 410_000, on: d.t },
      { cat: 'Langganan', amount: 153_000, on: d.t },
      { cat: 'Hiburan', amount: 275_000, on: d.t },
      { cat: 'Belanja', amount: 520_000, on: d.t },
    ],
    [{ amount: 500_000, on: d.t }],
  );
  const { uid, sid } = await spaceOf(OWNER, 'personal');
  await asUser(
    uid,
    `select api.set_budget(p_space_id => $1, p_category_id => (select id from app.categories where space_id = $1
       and name = 'Langganan'), p_month => (select label_month from app.pay_period($1, app.today())), p_amount => 180000::bigint)`,
    [sid],
  );
  await asUser(
    uid,
    `select api.set_budget(p_space_id => $1, p_category_id => (select id from app.categories where space_id = $1
       and name = 'Kopi & Camilan'), p_month => (select label_month from app.pay_period($1, app.today())), p_amount => 800000::bigint)`,
    [sid],
  );

  const b = await dates('shared');
  await seed({ kind: 'shared', wallet: 'Kas Rumah', opening: 5_000_000 }, [
    { cat: 'Belanja Dapur', amount: 420_000, on: b.p1 },
    { cat: 'Belanja Dapur', amount: 380_000, on: b.t },
    { cat: 'Sayur & Buah', amount: 190_000, on: b.t },
    { cat: 'Makan di Luar', amount: 265_000, on: b.t },
    { cat: 'Listrik & Air', amount: 540_000, on: b.t },
  ]);
});

test('LP1, LP3, LP4, LP5, LP9..LP11: Pribadi, Bersama, kalender, kosong', async ({
  browser,
  ownerState,
}) => {
  await shoot(browser, ownerState, '/pribadi/laporan', 'laporan-pribadi');
  await shoot(browser, ownerState, '/pribadi/laporan', 'laporan-pribadi-tabel-data', {
    widths: [320, 390],
    ready: async (p) => {
      await p.getByText('Tabel data').first().click();
    },
  });
  await shoot(browser, ownerState, '/bersama/laporan', 'laporan-bersama', {
    ready: async (p) => {
      await p
        .getByTestId('laporan-kategori')
        .first()
        .locator('summary')
        .click({ timeout: 2_000 })
        .catch(() => undefined);
    },
  });
  await shoot(browser, ownerState, '/pribadi/laporan?basis=kalender', 'laporan-kalender', {
    widths: [390, 1280],
  });
  await shoot(browser, ownerState, '/pribadi/laporan?periode=2020-01', 'laporan-kosong', {
    widths: [390, 1280],
  });
});

test('LP2: periode lengkap (pembanding) dan LP12 angka panjang', async ({
  browser,
  ownerState,
}) => {
  const d = await dates('personal');
  const [p] = await adminQuery<{ l: string }>(
    `select to_char(label_month - interval '1 month', 'YYYY-MM') as l from app.pay_period($1, app.today())`,
    [await spaceOf(OWNER, 'personal').then((s) => s.sid)],
  );
  await shoot(
    browser,
    ownerState,
    `/pribadi/laporan?periode=${p?.l ?? ''}`,
    'laporan-periode-lengkap',
    {
      widths: [390, 1280],
    },
  );
  const { uid, sid } = await spaceOf(OWNER, 'personal');
  await asUser(
    uid,
    `select api.create_entry(p_client_id => $1, p_space_id => $2,
       p_account_id => (select id from app.accounts where space_id = $2 and name = 'BCA Utama'),
       p_kind => 'expense', p_amount => 12345678900::bigint,
       p_category_id => (select id from app.categories where space_id = $2 and name = 'Hiburan'),
       p_occurred_on => $3::date, p_description => 'Perawatan kendaraan & servis rutin bulan',
       p_allow_negative => true)`,
    [randomUUID(), sid, d.t],
  );
  await shoot(browser, ownerState, '/pribadi/laporan', 'laporan-angka-panjang', {
    widths: [320, 390],
    themes: ['dark'],
  });
});
