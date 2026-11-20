import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { asUser, spaceOf } from '../e2e-auth/helpers';
import { adminQuery, expect, OWNER, test } from './fixtures';
import { expectRouteBudget } from './helpers';
import { openUntil, shooter } from './s14-shots';

/**
 * Screenshot S14 Task 10 (Detail dompet saham, sheet Beli/Jual/Isi harga/Saham yang sudah dimiliki,
 * dialog batal, kartu Modal trading) mode nyata untuk Delivery Gate, plus ukuran budget JS rute.
 * Bukan tes regresi: dilewati kecuali `SHOTS_DIR` diisi. Data lewat `api.*` sebagai pemilik (kondisi
 * harga `held` lewat superuser karena hanya penyedia otomatis yang menulisnya). Jalankan sendiri
 * (data kosong dari global-setup): `SHOTS_DIR=... playwright test -c playwright.ledger.config.ts screens-s14-saham`.
 */
const DIR = process.env.SHOTS_DIR;
test.skip(DIR === undefined, 'screenshot hanya dengan SHOTS_DIR');
test.describe.configure({ mode: 'serial' });
test.setTimeout(1_200_000);

const OUT = DIR ?? '';
const main = (page: Page) => page.getByRole('main');
const shoot = shooter(OUT);

let uid = '';
let sid = '';
const ids: Record<string, string> = {};
const id = (k: string): string => ids[k] ?? '';

async function api<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return asUser<T>(uid, sql, params);
}

async function wallet(name: string, pocket: 'operasional' | 'trading', opening: number) {
  await api(
    `select api.create_account(p_client_id => $1, p_space_id => $2, p_name => $3,
       p_pocket => $4::app.pocket, p_wallet_type => 'bank', p_opened_on => app.today() - 30,
       p_opening_balance => $5::bigint)`,
    [randomUUID(), sid, name, pocket, opening],
  );
  const [a] = await adminQuery<{ id: string }>(
    'select id::text from app.accounts where space_id = $1 and name = $2',
    [sid, name],
  );
  if (!a) throw new Error(`dompet ${name}`);
  ids[name] = a.id;
  return a.id;
}

async function stockWallet(name: string) {
  const [r] = await api<{ r: { account_id: string } }>(
    `select api.create_account(p_client_id => $1, p_space_id => $2, p_name => $3,
       p_pocket => 'aset'::app.pocket, p_wallet_type => 'cash', p_opened_on => app.today() - 30,
       p_asset_kind => 'saham') as r`,
    [randomUUID(), sid, name],
  );
  if (!r) throw new Error(`dompet saham ${name}`);
  ids[name] = r.r.account_id;
  return r.r.account_id;
}

const buy = (
  acc: string,
  ticker: string,
  shares: number,
  price: number,
  from: string,
  daysAgo: number,
  fee = 0,
) =>
  api(
    `select api.buy_stock($1, $2, $3, $4::bigint, $5::bigint, $6::bigint, $7, app.today() - $8::int)`,
    [randomUUID(), acc, ticker, shares, price, fee, from, daysAgo],
  );
const sell = (
  acc: string,
  ticker: string,
  shares: number,
  price: number,
  to: string,
  daysAgo: number,
) =>
  api(
    `select api.sell_stock($1, $2, $3, $4::bigint, $5::bigint, 0::bigint, 0::bigint, $6, app.today() - $7::int)`,
    [randomUUID(), acc, ticker, shares, price, to, daysAgo],
  );
const price = (ticker: string, close: number, daysAgo: number) =>
  api(`select api.set_stock_price($1, $2, $3, app.today() - $4::int, $5::bigint, true)`, [
    randomUUID(),
    sid,
    ticker,
    daysAgo,
    close,
  ]);

const detail = () => `/pribadi/dompet/${id('Ajaib')}`;

test('data: dompet, saham dalam berbagai keadaan harga', async ({ browser, ownerState }) => {
  await mkdir(OUT, { recursive: true });
  ({ uid, sid } = await spaceOf(OWNER, 'personal'));
  const bca = await wallet('BCA Utama', 'operasional', 60_000_000);
  const rdn = await wallet('RDN Ajaib', 'trading', 0);
  await api(
    `select api.create_transfer($1, $2, $3, $4, 20000000::bigint, 0::bigint, app.today() - 20)`,
    [randomUUID(), sid, bca, rdn],
  );
  const aj = await stockWallet('Ajaib');
  // Kosong dulu (tangkap keadaan awal), lalu isi.
  await shoot(browser, ownerState, 'ss-kosong', detail());
  await buy(aj, 'BBCA', 200, 9150, rdn, 12, 1000);
  await buy(aj, 'BBCA', 100, 9300, rdn, 8);
  await price('BBCA', 9800, 1);
  await buy(aj, 'TLKM', 500, 3000, bca, 10);
  await price('TLKM', 3200, 12);
  await buy(aj, 'GOTO', 1000, 70, bca, 6);
  await api(
    `select api.open_stock_holding($1, $2, 'ASII', 250::bigint, 5000::bigint, app.today() - 15)`,
    [randomUUID(), aj],
  );
  await price('ASII', 5000, 9);
  await adminQuery(
    `insert into app.stock_prices (space_id, ticker, on_date, close, source, status, reason)
     values ($1, 'ASII', app.today() - 1, 9000, 'provider', 'held', 'spike')`,
    [sid],
  );
  await buy(aj, 'BMRI', 100, 6000, bca, 7);
  await price('BMRI', 5000, 1);
  await buy(aj, 'UNVR', 100, 2500, bca, 9);
  await sell(aj, 'UNVR', 100, 2600, bca, 5);
  await shoot(browser, ownerState, 'ss-detail', detail());
});

test('Detail dompet saham: baris terbuka (rata-rata, harga, transaksi)', async ({
  browser,
  ownerState,
}) => {
  await shoot(browser, ownerState, 'ss-baris-terbuka', detail(), async (p) => {
    for (const t of ['BBCA', 'ASII']) {
      await main(p).getByTestId(`holding-${t}`).locator('summary').click();
    }
  });
  await shoot(browser, ownerState, 'ss-baris-tanpa-harga', detail(), async (p) => {
    for (const t of ['GOTO', 'TLKM']) {
      await main(p).getByTestId(`holding-${t}`).locator('summary').click();
    }
  });
});

test('sheet: Beli (kosong, terisi, saldo kurang), Jual (pratinjau), Isi harga (lonjakan), Saham yang sudah dimiliki', async ({
  browser,
  ownerState,
}) => {
  const dialog = (p: Page) => p.getByRole('dialog');
  const openTop = (p: Page, name: string, field: string) =>
    openUntil(
      () => main(p).getByRole('button', { name, exact: true }).first(),
      dialog(p),
      dialog(p).getByRole('textbox', { name: field }),
    );
  await shoot(
    browser,
    ownerState,
    'ss-sheet-beli-kosong',
    detail(),
    (p) => openTop(p, 'Beli saham', 'Kode saham'),
    {
      viewport: true,
    },
  );
  await shoot(
    browser,
    ownerState,
    'ss-sheet-beli-terisi',
    detail(),
    async (p) => {
      await openTop(p, 'Beli saham', 'Kode saham');
      const d = dialog(p);
      await d.getByRole('textbox', { name: 'Kode saham' }).fill('bmri');
      await d.getByRole('textbox', { name: 'Jumlah' }).fill('3');
      await d.getByRole('textbox', { name: 'Harga per lembar' }).fill('6000');
      await d.getByRole('textbox', { name: /Biaya broker/ }).fill('2700');
    },
    { viewport: true },
  );
  await shoot(
    browser,
    ownerState,
    'ss-sheet-beli-saldo-kurang',
    detail(),
    async (p) => {
      await openTop(p, 'Beli saham', 'Kode saham');
      const d = dialog(p);
      await d.getByRole('textbox', { name: 'Kode saham' }).fill('BBRI');
      await d.getByRole('textbox', { name: 'Jumlah' }).fill('99999');
      await d.getByRole('textbox', { name: 'Harga per lembar' }).fill('6000');
      await d.getByRole('combobox', { name: 'Dari dompet' }).selectOption({ label: 'BCA Utama' });
    },
    { viewport: true },
  );
  for (const [name, price, extra] of [
    ['untung', '9900', ''],
    ['rugi', '5000', ''],
  ] as const) {
    await shoot(
      browser,
      ownerState,
      `ss-sheet-jual-${name}`,
      detail(),
      async (p) => {
        await openTop(p, 'Jual saham', 'Jumlah');
        const d = dialog(p);
        await d.getByRole('combobox', { name: 'Kode saham' }).selectOption('BBCA');
        await d.getByRole('textbox', { name: 'Jumlah' }).fill('1');
        await d.getByRole('textbox', { name: 'Harga per lembar' }).fill(price + extra);
        await d.getByRole('textbox', { name: /Biaya broker/ }).fill('2000');
        await d.getByRole('textbox', { name: /Pajak jual/ }).fill('1000');
        await expect(d.getByText(/Hasil bersih/)).toBeVisible({ timeout: 10_000 });
      },
      { viewport: true },
    );
  }
  await shoot(
    browser,
    ownerState,
    'ss-sheet-jual-berlebih',
    detail(),
    async (p) => {
      await openTop(p, 'Jual saham', 'Jumlah');
      const d = dialog(p);
      await d.getByRole('textbox', { name: 'Jumlah' }).fill('9');
      await d.getByRole('textbox', { name: 'Harga per lembar' }).fill('9800');
      await d.getByRole('button', { name: 'Simpan penjualan' }).click();
      await expect(d.getByText('Jumlahnya melebihi saham yang dimiliki.')).toBeVisible();
    },
    { viewport: true },
  );
  await shoot(
    browser,
    ownerState,
    'ss-sheet-isi-harga-lonjakan',
    detail(),
    async (p) => {
      await openTop(p, 'Isi harga', 'Harga penutupan per lembar');
      const d = dialog(p);
      await d.getByRole('textbox', { name: 'Harga penutupan per lembar' }).fill('20000');
      await d.getByRole('button', { name: 'Simpan harga' }).click();
      await expect(d.getByRole('checkbox', { name: 'Ya, harga ini benar' })).toBeVisible({
        timeout: 10_000,
      });
    },
    { viewport: true },
  );
  await shoot(
    browser,
    ownerState,
    'ss-sheet-dimiliki',
    detail(),
    async (p) => {
      await openUntil(
        () => main(p).getByRole('button', { name: 'Saham yang sudah dimiliki' }).first(),
        dialog(p),
        dialog(p).getByRole('textbox', { name: 'Kode saham' }),
      );
      const d = dialog(p);
      await d.getByRole('textbox', { name: 'Kode saham' }).fill('BBCA');
      await d.getByRole('textbox', { name: 'Jumlah' }).fill('250');
      await d.getByRole('textbox', { name: 'Harga rata-rata per lembar' }).fill('9000');
    },
    { viewport: true },
  );
});

test('dialog batal transaksi terakhir (beli, jual)', async ({ browser, ownerState }) => {
  await shoot(
    browser,
    ownerState,
    'ss-dialog-batal',
    detail(),
    async (p) => {
      await main(p).getByTestId('holding-BBCA').locator('summary').click();
      await openUntil(
        () => main(p).getByRole('button', { name: 'Batalkan transaksi BBCA terakhir' }),
        p.getByRole('alertdialog'),
      );
    },
    { viewport: true },
  );
});

test('Dompet: daftar dengan dompet saham dan kartu Modal trading (Saham, lalu Kurang)', async ({
  browser,
  ownerState,
}) => {
  await shoot(browser, ownerState, 'ss-dompet-modal', '/pribadi/dompet');
  await shoot(browser, ownerState, 'ss-detail-trading', `/pribadi/dompet/${id('RDN Ajaib')}`);
  // Rugi trading dicatat lewat Cocokkan saldo: sisa modal melebihi saldo + biaya beli saham.
  await api(`select api.reconcile_balance($1, $2, 5000000::bigint)`, [
    randomUUID(),
    id('RDN Ajaib'),
  ]);
  await shoot(browser, ownerState, 'ss-dompet-modal-kurang', '/pribadi/dompet');
});

test('nilai besar dan nama panjang di 320: lembar 12.345.600, harga, hasil', async ({
  browser,
  ownerState,
}) => {
  const bca = id('BCA Utama');
  const big = await stockWallet('Dompet Saham Dengan Nama Yang Sangat Panjang Sekali Uji');
  await api(`select api.reconcile_balance($1, $2, 900000000000::bigint)`, [randomUUID(), bca]);
  await buy(big, 'ADRO', 12_345_600, 2000, bca, 3);
  await price('ADRO', 2300, 1);
  await shoot(browser, ownerState, 'ss-nilai-besar', `/pribadi/dompet/${big}`, async (p) => {
    await main(p).getByTestId('holding-ADRO').locator('summary').click();
  });
});

test('budget JS rute Detail dompet saham dan Dompet', async ({ browser, ownerState }) => {
  const a = await expectRouteBudget(browser, ownerState, detail());
  const b = await expectRouteBudget(browser, ownerState, '/pribadi/dompet');
  console.log(`BUDGET detail-saham=${a.toFixed(1)} dompet=${b.toFixed(1)}`);
});
