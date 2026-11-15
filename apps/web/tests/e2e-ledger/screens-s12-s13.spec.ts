import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import type { Browser, Locator, Page } from '@playwright/test';
import { asUser, spaceOf } from '../e2e-auth/helpers';
import { adminQuery, expect, OWNER, test } from './fixtures';

/**
 * Screenshot S12 (kartu Utang, modal trading) dan S13 (Tujuan tabungan) mode nyata untuk design
 * critique (`docs/design/s12-s13-critique.md`). Bukan tes regresi: dilewati kecuali `SHOTS_DIR`
 * diisi. Data dibuat lewat `api.*` sebagai pemilik (bukan UI), keadaan berurutan karena beberapa
 * layar hanya benar pada tahap tertentu (kosong, satu, banyak). Setiap layar dipotret 320/390/1280
 * gelap dan terang; tiap tangkapan juga mencatat audit teks/warna ke `_audit.jsonl` (kata terlarang,
 * `Rp 0`, warna merah/hijau/amber pada teks angka, gulir horizontal). Jalankan sendiri (data kosong
 * dari global-setup): `SHOTS_DIR=... playwright test -c playwright.ledger.config.ts screens-s12-s13`.
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
const LONG_SAV = 'Tabungan pendidikan anak pertama dan kedua di bank syariah cabang'.slice(0, 60);
const LONG_GOAL = 'Liburan keluarga besar ke luar negeri tahun depan bersama saudara'.slice(0, 60);
const BIG = 12_345_678_900;

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

let uid = '';
let sid = '';
const ids: Record<string, string> = {};

async function api<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return asUser<T>(uid, sql, params);
}

async function wallet(
  name: string,
  pocket: 'operasional' | 'tabungan' | 'trading',
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

async function transfer(from: string, to: string, amount: number) {
  await api(
    `select api.create_transfer(p_client_id => $1, p_space_id => $2, p_from_account => $3,
       p_to_account => $4, p_amount => $5::bigint, p_allow_negative => true)`,
    [randomUUID(), sid, ids[from], ids[to], amount],
  );
}

async function reconcile(name: string, target: number) {
  await api(`select api.reconcile_balance($1, $2, $3::bigint)`, [randomUUID(), ids[name], target]);
}

async function goal(account: string, name: string, target: number, on: string | null = null) {
  await api(
    `select api.create_goal(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_name => $4, p_target_amount => $5::bigint, p_target_on => $6::date)`,
    [randomUUID(), sid, ids[account], name, target, on],
  );
  const [g] = await adminQuery<{ id: string }>(
    'select id::text from app.goals where name = $1 order by created_at desc limit 1',
    [name],
  );
  if (!g) throw new Error(`tujuan ${name}`);
  ids[`goal:${name}`] = g.id;
}

async function debt(
  direction: 'borrowed' | 'lent',
  contact: string,
  principal: number,
  account: string,
  title?: string,
) {
  await api(
    `select api.create_debt(p_client_id => $1, p_space_id => $2, p_direction => $3,
       p_principal => $4::bigint, p_mode => 'baru', p_contact_name => $5, p_account_id => $6,
       p_title => $7)`,
    [randomUUID(), sid, direction, principal, contact, ids[account], title ?? null],
  );
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
    const banned = [...text.matchAll(/Hutang|hutang|rumah tangga|Goal|goal|!|\p{Extended_Pictographic}/gu)].map(
      (m) => m[0],
    );
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

const rencanaTujuan = '/pribadi/rencana?bagian=tujuan';

test('data awal dan layar kosong (sebelum dompet apa pun)', async ({ browser, ownerState }) => {
  await mkdir(OUT, { recursive: true });
  ({ uid, sid } = await spaceOf(OWNER, 'personal'));
  const bersama = await spaceOf(OWNER, 'shared');
  ids.bersama = bersama.sid;
  // Beranda tanpa utang: kartu Utang tidak dirender; Tujuan kosong tanpa dompet tabungan.
  await shoot(browser, ownerState, 'tj-kosong-tanpa-dompet', rencanaTujuan);
  await shoot(browser, ownerState, 'tj-kosong-tanpa-dompet-bersama', '/bersama/rencana?bagian=tujuan');
  await shoot(browser, ownerState, 'pt-bersama-solo', '/bersama/patungan');
  await wallet('BCA Utama', 'operasional', 10_000_000);
  await wallet(LONG_WALLET, 'operasional', BIG);
});

test('trading: kosong, setor, Kurang, hasil ditarik, nominal besar', async ({
  browser,
  ownerState,
  page,
}) => {
  await wallet('Stockbit', 'trading', 0);
  const dompetId = () => ids['Stockbit'];
  // Kartu Modal belum ada setoran.
  await shoot(browser, ownerState, 'tr-dompet-kosong', '/pribadi/dompet');
  await shoot(browser, ownerState, 'tr-detail-kosong', `/pribadi/dompet/${dompetId()}`);

  await transfer('BCA Utama', 'Stockbit', 5_000_000);
  await shoot(browser, ownerState, 'tr-dompet-modal', '/pribadi/dompet');
  await shoot(browser, ownerState, 'tr-detail-modal', `/pribadi/dompet/${dompetId()}`);
  // Sheet Setor modal.
  await shoot(
    browser,
    ownerState,
    'tr-sheet-setor',
    `/pribadi/dompet/${dompetId()}`,
    async (p) => {
      const sheet = p.getByRole('dialog', { name: /^Setor modal/ });
      await openUntil(
        () => main(p).getByRole('button', { name: 'Setor modal' }),
        sheet,
        sheet.getByRole('textbox', { name: 'Nominal' }),
      );
      await sheet.getByRole('textbox', { name: 'Nominal' }).fill('1000000');
    },
    { viewport: true },
  );

  // Turun: Kurang.
  await reconcile('Stockbit', 4_200_000);
  await shoot(browser, ownerState, 'tr-dompet-kurang', '/pribadi/dompet');
  await shoot(browser, ownerState, 'tr-detail-kurang', `/pribadi/dompet/${dompetId()}`);

  // Naik, lalu Tarik lebih dari sisa modal: pratinjau hasil ditarik.
  await reconcile('Stockbit', 6_000_000);
  await shoot(
    browser,
    ownerState,
    'tr-sheet-tarik-lebih',
    `/pribadi/dompet/${dompetId()}`,
    async (p) => {
      const sheet = p.getByRole('dialog', { name: /^Tarik modal/ });
      await openUntil(
        () => main(p).getByRole('button', { name: 'Tarik modal' }),
        sheet,
        sheet.getByRole('textbox', { name: 'Nominal' }),
      );
      await sheet.getByRole('textbox', { name: 'Nominal' }).fill('5500000');
    },
    { viewport: true },
  );
  await transfer('Stockbit', 'BCA Utama', 6_000_000);
  await shoot(browser, ownerState, 'tr-dompet-ditarik-semua', '/pribadi/dompet');
  await shoot(browser, ownerState, 'tr-detail-ditarik-semua', `/pribadi/dompet/${dompetId()}`);

  // Nominal besar + Kurang besar + nama dompet panjang.
  const big = 'Kripto Besar Dengan Nama Rekening Yang Panjang Sekali di Luar Negeri'.slice(0, 60);
  await wallet(big, 'trading', 0);
  await transfer(LONG_WALLET, big, BIG);
  await reconcile(big, 100);
  await shoot(browser, ownerState, 'tr-dompet-besar', '/pribadi/dompet');
  await shoot(browser, ownerState, 'tr-detail-besar', `/pribadi/dompet/${ids[big]}`);
  // Tambah dompet: opsi Trading di 320 (empat jenis) + keterangan.
  await shoot(
    browser,
    ownerState,
    'tr-sheet-tambah-dompet',
    '/pribadi/dompet?tambah=1',
    async (p) => {
      const sheet = p.getByRole('dialog', { name: /Tambah dompet/ });
      await expect(sheet.getByRole('textbox', { name: 'Nama' })).toBeVisible();
      await sheet.getByRole('textbox', { name: 'Nama' }).fill('Rekening Saham');
      await sheet.getByRole('radio', { name: 'Trading' }).click();
    },
    { viewport: true },
  );
  void page;
});

test('kartu Utang di Beranda Pribadi: hanya piutang, keduanya, nominal besar', async ({
  browser,
  ownerState,
}) => {
  await shoot(browser, ownerState, 'ut-beranda-tanpa-utang', '/pribadi/beranda');
  await debt('lent', 'Sari', 750_000, 'BCA Utama', 'Pinjam untuk servis motor');
  await shoot(browser, ownerState, 'ut-beranda-hanya-piutang', '/pribadi/beranda');
  await debt('borrowed', 'Budi', 2_500_000, 'BCA Utama', 'Pinjam DP kontrakan');
  await shoot(browser, ownerState, 'ut-beranda-keduanya', '/pribadi/beranda');
  await debt(
    'borrowed',
    'Bank Pembangunan Daerah Cabang Utama Kota Besar',
    BIG,
    LONG_WALLET,
    'KPR rumah',
  );
  await shoot(browser, ownerState, 'ut-beranda-besar', '/pribadi/beranda');
  await shoot(browser, ownerState, 'ut-beranda-bersama-tanpa-jejak', '/bersama/beranda');
});

test('tujuan: tanpa tujuan, satu, banyak, dompet, sheet dan dialog', async ({
  browser,
  ownerState,
}) => {
  // Dompet tabungan tanpa tujuan.
  await wallet('Dana Darurat', 'tabungan', 4_500_000);
  await shoot(browser, ownerState, 'tj-kosong-ada-dompet', rencanaTujuan);
  await wallet('Tabungan Liburan', 'tabungan', 50_000);
  await wallet('Tabungan Rumah', 'tabungan', 0);
  await wallet('Tabungan Minus', 'tabungan', 100_000);
  await wallet('Tabungan Mobil', 'tabungan', 10_250_000);
  await wallet('Tabungan Lewat', 'tabungan', 2_000_000);
  await wallet(LONG_SAV, 'tabungan', BIG);
  await wallet('Tabungan Selesai', 'tabungan', 3_000_000);
  await wallet('Tabungan Arsip', 'tabungan', 0);
  await wallet('Tabungan Tanpa Tujuan', 'tabungan', 600_000);
  // Saldo minus lewat pengeluaran paksa.
  const [cat] = await adminQuery<{ id: string }>(
    `select id::text from app.categories where space_id = $1 and type = 'expense'
      and parent_id is null order by sort_order limit 1`,
    [sid],
  );
  await api(
    `select api.create_entry(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_kind => 'expense', p_amount => 300000::bigint, p_category_id => $4,
       p_description => 'Bayar darurat', p_allow_negative => true)`,
    [randomUUID(), sid, ids['Tabungan Minus'], cat?.id],
  );

  await shoot(browser, ownerState, 'tj-dompet-tanpa-tujuan', '/pribadi/dompet');
  await shoot(browser, ownerState, 'tj-detail-ajakan', `/pribadi/dompet/${ids['Tabungan Tanpa Tujuan']}`);
  // Sheet Tambah tujuan dari Rencana (pemilih banyak dompet).
  await shoot(
    browser,
    ownerState,
    'tj-sheet-tambah',
    rencanaTujuan,
    async (p) => {
      const sheet = p.getByRole('dialog', { name: /^Tambah tujuan/ });
      await openUntil(
        () => main(p).getByRole('button', { name: 'Tambah tujuan' }).first(),
        sheet,
        sheet.getByRole('textbox', { name: /Nama tujuan/ }),
      );
      await sheet.getByRole('textbox', { name: /Nama tujuan/ }).fill(LONG_GOAL);
      await sheet.getByRole('textbox', { name: /Target/ }).fill('12345678900');
      await sheet.getByLabel(/Tanggal target/).fill(inDays(120));
    },
    { viewport: true },
  );
  // Dari Detail dompet: dompet terkunci.
  await shoot(
    browser,
    ownerState,
    'tj-sheet-tambah-terkunci',
    `/pribadi/dompet/${ids['Tabungan Tanpa Tujuan']}`,
    async (p) => {
      const sheet = p.getByRole('dialog', { name: /^Tambah tujuan/ });
      await openUntil(
        () => main(p).getByRole('button', { name: 'Buat tujuan' }),
        sheet,
        sheet.getByRole('textbox', { name: /Nama tujuan/ }),
      );
    },
    { viewport: true },
  );

  // Satu tujuan.
  await goal('Dana Darurat', 'Dana darurat', 10_000_000, inDays(200));
  await shoot(browser, ownerState, 'tj-satu', rencanaTujuan);
  await shoot(browser, ownerState, 'tj-detail-dengan-tujuan', `/pribadi/dompet/${ids['Dana Darurat']}`);

  // Banyak tujuan, berbagai keadaan.
  await goal('Tabungan Liburan', 'Liburan Desember', 10_000_000);
  await goal('Tabungan Rumah', 'Beli rumah', 500_000_000, inDays(400));
  await goal('Tabungan Minus', 'Perbaikan dapur', 5_000_000, inDays(90));
  await goal('Tabungan Mobil', 'Mobil bekas', 10_000_000);
  await goal('Tabungan Lewat', 'Renovasi kamar', 8_000_000, inDays(5));
  await adminQuery(`update app.goals set target_on = date '2026-10-01' where name = 'Renovasi kamar'`);
  await goal(LONG_SAV, LONG_GOAL, 98_765_432_100, inDays(100));
  await goal('Tabungan Selesai', 'Laptop kerja', 3_000_000);
  await api('select api.complete_goal($1::uuid)', [ids['goal:Laptop kerja']]);
  await goal('Tabungan Arsip', 'Tujuan lama', 1_000_000);
  await api('select api.archive_goal($1::uuid)', [ids['goal:Tujuan lama']]);
  await api('select api.archive_account($1::uuid)', [ids['Tabungan Arsip']]);

  await shoot(browser, ownerState, 'tj-banyak', rencanaTujuan);
  await shoot(browser, ownerState, 'tj-banyak-terlipat-terbuka', rencanaTujuan, async (p) => {
    await main(p).locator('details').filter({ hasText: /Selesai dan diarsipkan/ }).locator('summary').click();
    await expect(main(p).getByText('Dompet sudah diarsipkan')).toBeVisible();
  });
  await shoot(browser, ownerState, 'tj-dompet-teks-tujuan', '/pribadi/dompet');
  await shoot(browser, ownerState, 'tj-detail-tercapai', `/pribadi/dompet/${ids['Tabungan Mobil']}`);
  await shoot(browser, ownerState, 'tj-detail-saldo-nol', `/pribadi/dompet/${ids['Tabungan Rumah']}`);
  await shoot(browser, ownerState, 'tj-detail-panjang', `/pribadi/dompet/${ids[LONG_SAV]}`);

  // Dialog dan sheet dari kartu.
  const cardOf = (p: Page, name: string) => main(p).getByRole('region', { name, exact: true });
  await shoot(
    browser,
    ownerState,
    'tj-sheet-ubah',
    rencanaTujuan,
    async (p) => {
      const sheet = p.getByRole('dialog', { name: /^Ubah tujuan/ });
      await openUntil(
        () => cardOf(p, 'Renovasi kamar').getByRole('button', { name: /^Ubah/ }),
        sheet,
        sheet.getByRole('textbox', { name: /Nama tujuan/ }),
      );
    },
    { viewport: true },
  );
  await shoot(
    browser,
    ownerState,
    'tj-dialog-selesaikan',
    rencanaTujuan,
    async (p) => {
      const dlg = p.getByRole('alertdialog').or(p.getByRole('dialog', { name: /^Selesaikan/ }));
      await openUntil(
        () => cardOf(p, 'Mobil bekas').getByRole('button', { name: /^Selesaikan/ }),
        dlg,
      );
    },
    { viewport: true },
  );
  await shoot(
    browser,
    ownerState,
    'tj-dialog-arsipkan',
    rencanaTujuan,
    async (p) => {
      const dlg = p.getByRole('alertdialog').or(p.getByRole('dialog', { name: /^Arsipkan/ }));
      await openUntil(
        () => cardOf(p, 'Dana darurat').getByRole('button', { name: /^Arsipkan/ }),
        dlg,
      );
    },
    { viewport: true },
  );

  // Arsip dompet bertujuan: saldo 0 dengan tujuan aktif (Tabungan Rumah) = kartu tolakan.
  await shoot(browser, ownerState, 'tj-detail-arsip-ditolak', `/pribadi/dompet/${ids['Tabungan Rumah']}`, async (p) => {
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  });

  // Semua dompet tabungan bertujuan.
  await goal('Tabungan Tanpa Tujuan', 'Cadangan', 2_000_000);
  await shoot(browser, ownerState, 'tj-semua-bertujuan', rencanaTujuan);
});

test('Bersama solo: tujuan dengan dompet tabungan Bersama, tanpa "Dibuat"', async ({
  browser,
  ownerState,
}) => {
  await wallet('Tabungan Bersama Solo', 'tabungan', 2_000_000, ids.bersama);
  await shoot(browser, ownerState, 'tj-bersama-solo-kosong', '/bersama/rencana?bagian=tujuan');
  await api(
    `select api.create_goal(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_name => 'Dana liburan bersama', p_target_amount => 8000000::bigint, p_target_on => $4::date)`,
    [randomUUID(), ids.bersama, ids['Tabungan Bersama Solo'], inDays(240)],
  );
  await shoot(browser, ownerState, 'tj-bersama-solo-satu', '/bersama/rencana?bagian=tujuan');
});
