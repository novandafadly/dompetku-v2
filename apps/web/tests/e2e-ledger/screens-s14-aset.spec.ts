import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import type { Browser, Locator, Page } from '@playwright/test';
import { asUser, spaceOf } from '../e2e-auth/helpers';
import { adminQuery, expect, OWNER, test } from './fixtures';

/**
 * Screenshot S14 Task 9 (hero Kekayaan bersih, kelompok Aset, Detail aset, sheet Tambah aset,
 * Perbarui nilai, Isi/Cairkan) mode nyata untuk Delivery Gate. Bukan tes regresi: dilewati kecuali
 * `SHOTS_DIR` diisi. Data lewat `api.*` sebagai pemilik; setiap layar dipotret 320/390/1280 gelap
 * dan terang dengan audit teks/warna ke `_audit.jsonl` (kata terlarang S14, `Rp 0`, warna
 * merah/hijau/amber pada teks angka, gulir horizontal). Jalankan sendiri (data kosong dari
 * global-setup): `SHOTS_DIR=... playwright test -c playwright.ledger.config.ts screens-s14-aset`.
 */
const DIR = process.env.SHOTS_DIR;
test.skip(DIR === undefined, 'screenshot hanya dengan SHOTS_DIR');
test.describe.configure({ mode: 'serial' });
test.setTimeout(900_000);

const OUT = DIR ?? '';
const main = (page: Page) => page.getByRole('main');
const WIDTHS = [320, 390, 1280] as const;
const THEMES = ['dark', 'light'] as const;
const BASE = 'http://localhost:3301';

const LONG_WALLET = 'Dompet Operasional Utama Dengan Nama Yang Sangat Panjang Sekali'.slice(0, 60);
const BIG = 12_345_678_900;

let uid = '';
let sid = '';
const ids: Record<string, string> = {};
const id = (k: string): string => ids[k] ?? '';

async function api<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return asUser<T>(uid, sql, params);
}

async function wallet(
  name: string,
  pocket: 'operasional' | 'tabungan',
  opening: number,
  space = sid,
) {
  const [r] = await api<{ r: { account_id: string } }>(
    `select api.create_account(p_client_id => $1, p_space_id => $2, p_name => $3,
       p_pocket => $4::app.pocket, p_wallet_type => 'bank', p_opening_balance => $5::bigint) as r`,
    [randomUUID(), space, name, pocket, opening],
  );
  const [a] = await adminQuery<{ id: string }>(
    'select id::text from app.accounts where space_id = $1 and name = $2',
    [space, name],
  );
  if (!a || !r) throw new Error(`dompet ${name}`);
  ids[name] = a.id;
  return a.id;
}

// --- audit ---------------------------------------------------------------------------------

interface Audit {
  name: string;
  w: number;
  theme: string;
  overflow: number;
  banned: string[];
  rpZero: string[];
  coloredNumbers: string[];
}

async function auditPage(page: Page, name: string, w: number, theme: string): Promise<Audit> {
  const r = await page.evaluate(() => {
    const probe = (v: string) => {
      const el = document.createElement('span');
      el.style.color = `var(${v})`;
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    };
    const flagged: Record<string, string> = {
      [probe('--danger')]: 'danger',
      [probe('--warning')]: 'warning',
      [probe('--income')]: 'income',
    };
    const mainEl = document.querySelector('main');
    const text = (mainEl ?? document.body).innerText;
    const banned = [
      ...text.matchAll(
        /Hutang|hutang|rumah tangga|Goal|goal|Net worth|Portfolio|portofolio|P\/L|holding|ticker|unrealized|!|\p{Extended_Pictographic}/gu,
      ),
    ].map((m) => m[0]);
    const rpZero = [...text.matchAll(/.{0,30}Rp\s?0(?![\d.])(?!\s?\/).{0,20}/g)].map((m) => m[0]);
    const colored: string[] = [];
    (mainEl ?? document.body).querySelectorAll<HTMLElement>('*').forEach((el) => {
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own || !/(Rp\s?\d|\d+\s?%|Kurang|berutang|Piutang)/.test(own)) return;
      const c = getComputedStyle(el).color;
      const tag = flagged[c];
      if (tag) colored.push(`${tag}: ${own.slice(0, 60)}`);
    });
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      banned,
      rpZero,
      colored,
    };
  });
  return {
    name,
    w,
    theme,
    overflow: r.overflow,
    banned: r.banned,
    rpZero: r.rpZero,
    coloredNumbers: r.colored,
  };
}

async function fail(name: string, e: unknown) {
  await appendFile(`${OUT}/_failures.txt`, `${name}: ${String(e).split('\n')[0] ?? ''}\n`);
}

type Act = (p: Page) => Promise<void>;
interface Opts {
  /** Tangkap viewport saja (sheet/dialog) alih-alih halaman penuh. */
  viewport?: boolean;
  widths?: readonly number[];
  themes?: readonly ('dark' | 'light')[];
}

/** Potret `path` di semua ukuran dan tema; `act` membuka sheet/dialog atau menggulir. */
async function shoot(
  browser: Browser,
  state: string,
  name: string,
  path: string,
  act?: Act,
  opts: Opts = {},
) {
  for (const theme of opts.themes ?? THEMES) {
    for (const w of opts.widths ?? WIDTHS) {
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
        await page.waitForTimeout(350);
        const audit = await auditPage(page, name, w, theme);
        await appendFile(`${OUT}/_audit.jsonl`, `${JSON.stringify(audit)}\n`);
        if (opts.viewport !== true) {
          await page.evaluate(() => {
            document.querySelectorAll<HTMLElement>('nav[aria-label="Tab utama"]').forEach((el) => {
              el.style.display = 'none';
            });
          });
          if (w === 1280) {
            const dh = await page.evaluate(() => document.documentElement.scrollHeight);
            await page.setViewportSize({ width: w, height: Math.min(Math.max(h, dh), 3000) });
            await page.waitForTimeout(250);
          }
        }
        await page.screenshot({
          path: `${OUT}/${name}-${String(w)}-${theme}.png`,
          fullPage: opts.viewport !== true,
          animations: 'disabled',
        });
      } catch (e) {
        await fail(`${name}-${String(w)}-${theme}`, e);
      } finally {
        await context.close();
      }
    }
  }
}

/** Ulangi klik sampai sheet/dialog malas benar-benar tampil. */
async function openUntil(open: () => Locator, dialog: Locator, field?: Locator) {
  await expect(async () => {
    if ((await dialog.count()) === 0) await open().click();
    await expect(field ?? dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

const ASSET_KINDS = 'emas';

async function asset(name: string, kind: string, opening: number, space = sid) {
  const [r] = await api<{ r: { account_id: string } }>(
    `select api.create_account(p_client_id => $1, p_space_id => $2, p_name => $3,
       p_pocket => 'aset'::app.pocket, p_wallet_type => 'cash', p_opened_on => app.today() - 20,
       p_opening_balance => $5::bigint, p_asset_kind => $4) as r`,
    [randomUUID(), space, name, kind, opening],
  );
  if (!r) throw new Error(`aset ${name}`);
  ids[name] = r.r.account_id;
  return r.r.account_id;
}

async function revalue(name: string, value: number) {
  await api(`select api.revalue_asset($1, $2, $3::bigint, app.today() - 5)`, [
    randomUUID(),
    ids[name],
    value,
  ]);
}

async function nonModal(page: Page, dialog: Locator, field: Locator) {
  await expect(async () => {
    if ((await dialog.count()) === 0) {
      await main(page)
        .getByRole('button', { name: /Tambah aset/ })
        .first()
        .click();
    }
    await expect(field).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test('hero kekayaan dan Dompet: hanya kas, lalu aset, nilai 0, nominal besar', async ({
  browser,
  ownerState,
}) => {
  await mkdir(OUT, { recursive: true });
  ({ uid, sid } = await spaceOf(OWNER, 'personal'));
  const bersama = await spaceOf(OWNER, 'shared');
  ids.bersama = bersama.sid;
  await wallet('BCA Utama', 'operasional', 10_000_000);
  await shoot(browser, ownerState, 'nw-hanya-kas', '/pribadi/dompet');
  await asset('Emas Antam', ASSET_KINDS, 5_000_000);
  await asset('Rumah Bekasi', 'properti', 0);
  await shoot(browser, ownerState, 'nw-aset-dan-nol', '/pribadi/dompet');
  await asset(LONG_WALLET, 'kendaraan', BIG);
  await wallet(LONG_WALLET.slice(0, 40), 'operasional', BIG);
  await shoot(browser, ownerState, 'nw-nominal-besar', '/pribadi/dompet');
  await asset('Mobil Keluarga', 'kendaraan', 90_000_000, bersama.sid);
  await shoot(browser, ownerState, 'nw-bersama-aset', '/bersama/dompet');
});

test('Detail aset: dengan valuasi, nilai 0, arsip ditolak', async ({ browser, ownerState }) => {
  await revalue('Emas Antam', 5_400_000);
  await shoot(browser, ownerState, 'as-detail-valuasi', `/pribadi/dompet/${id('Emas Antam')}`);
  await shoot(browser, ownerState, 'as-detail-nol', `/pribadi/dompet/${id('Rumah Bekasi')}`);
  await shoot(browser, ownerState, 'as-detail-panjang', `/pribadi/dompet/${id(LONG_WALLET)}`);
  await shoot(browser, ownerState, 'as-detail-bersama', `/bersama/dompet/${id('Mobil Keluarga')}`);
});

test('sheet: Tambah aset (Pribadi, Bersama), Perbarui nilai, Isi, Cairkan', async ({
  browser,
  ownerState,
}) => {
  await shoot(
    browser,
    ownerState,
    'as-sheet-tambah',
    '/pribadi/dompet',
    async (p) => {
      const sheet = p.getByRole('dialog', { name: /Tambah aset/ });
      await nonModal(p, sheet, sheet.getByLabel('Jenis aset'));
      await sheet.getByLabel('Jenis aset').selectOption('emas');
      await sheet.getByRole('textbox', { name: 'Nama' }).fill('Emas Batangan');
    },
    { viewport: true },
  );
  await shoot(
    browser,
    ownerState,
    'as-sheet-tambah-bersama',
    '/bersama/dompet',
    async (p) => {
      const sheet = p.getByRole('dialog', { name: /Tambah aset/ });
      await nonModal(p, sheet, sheet.getByLabel('Jenis aset'));
    },
    { viewport: true },
  );
  const detail = `/pribadi/dompet/${id('Emas Antam')}`;
  for (const [name, button, nominal] of [
    ['as-sheet-perbarui', 'Perbarui nilai', '6000000'],
    ['as-sheet-isi', 'Isi dari dompet', '1000000'],
    ['as-sheet-cairkan', 'Cairkan ke dompet', '9000000'],
  ] as const) {
    await shoot(
      browser,
      ownerState,
      name,
      detail,
      async (p) => {
        const sheet = p.getByRole('dialog');
        await openUntil(
          () => main(p).getByRole('button', { name: button }),
          sheet,
          sheet.getByRole('textbox', { name: /Nilai sekarang|Nominal/ }),
        );
        await sheet.getByRole('textbox', { name: /Nilai sekarang|Nominal/ }).fill(nominal);
      },
      { viewport: true },
    );
  }
});

test('Transaksi, Laporan, Sampah: baris perubahan nilai (hidup dan batal)', async ({
  browser,
  ownerState,
}) => {
  await revalue('Emas Antam', 4_900_000);
  // Valuasi turun dibatalkan supaya Sampah punya baris `Perubahan nilai`.
  const [v] = await adminQuery<{ id: string; version: number }>(
    `select e.id::text, e.version from app.entries e join app.entry_lines l on l.entry_id = e.id
      where e.kind = 'valuation' and l.account_id = $1 and e.voided_at is null
      order by e.created_at desc limit 1`,
    [id('Emas Antam')],
  );
  if (!v) throw new Error('valuasi');
  await revalue('Rumah Bekasi', 750_000_000);
  await api(`select api.void_entry($1, $2, $3)`, [randomUUID(), v.id, v.version]);
  await shoot(browser, ownerState, 'as-transaksi', '/pribadi/transaksi');
  await shoot(browser, ownerState, 'as-laporan', '/pribadi/laporan');
  await shoot(browser, ownerState, 'as-sampah', '/pribadi/sampah');
});
