import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../e2e/axe';
import { asUser, noHorizontalScroll, spaceOf } from '../e2e-auth/helpers';
import { adminQuery, expect, OWNER, test } from './fixtures';
import {
  addWallet,
  digits,
  expectRouteBudget,
  readHero,
  rupiahOf,
  spaceId,
  toasts,
} from './helpers';

/**
 * S14 Task 12 mode nyata: saham di Dompet Pribadi (T11 bagian saham, I6, K7). Dompet trading dengan
 * modal -> dompet saham (jenis Saham) -> Beli 2 lot lalu 1 lot dengan dua harga (biaya rata-rata) ->
 * Isi harga (nilai pasar dan kekayaan bersih) -> harga melonjak minta konfirmasi -> Jual 1 lot
 * (untung) -> Batalkan jual -> Jual 1 lot (rugi) -> Saham yang sudah dimiliki (tanpa efek kas) ->
 * arsip dompet saham berisi ditolak -> Modal trading: `Kurang` total tidak palsu sesudah beli saham
 * dari trading (K7) dan menyebut Saham (biaya beli). 320 px + axe di Detail dompet saham dan semua
 * sheetnya, budget JS. MENGISI data dan tidak membersihkannya: project `data`; berkas `zz-` jalan
 * paling akhir (kartu Modal trading memuat semua dompet trading Pribadi, jadi `Kurang` dihitung
 * sebagai selisih terhadap keadaan sebelum beli, bukan angka mutlak). Satu urutan serial.
 */
test.describe.configure({ mode: 'serial' });

const main = (page: Page) => page.getByRole('main');
const BANK = 'Bank Saham E2E';
const RDN = 'RDN Saham E2E';
const SEK = 'Sekuritas E2E';
const MODAL = 20_000_000;
const rp = (n: number) => `Rp ${digits(n)}`;
const rpRe = (n: number) => new RegExp(`Rp\\s${digits(n).replaceAll('.', '\\.')}`);
const state = { rdn: '', sek: '' };

const money = rupiahOf;
const txt = async (l: Locator) => ((await l.textContent()) ?? '').replaceAll(' ', ' ');

const hero = (page: Page) => readHero(page, 'pribadi');

async function sqlNetWorth(): Promise<number> {
  const [r] = await adminQuery<{ total: string }>(
    'select total::text from app.net_worth_at($1, app.today())',
    [await spaceId('personal')],
  );
  return Number(r?.total);
}

async function balanceOf(name: string): Promise<number> {
  const [r] = await adminQuery<{ b: string }>(
    `select b.balance::text as b from app.accounts a
       join app.account_balances b on b.account_id = a.id where a.name = $1`,
    [name],
  );
  return Number(r?.b);
}

async function incomeExpense(): Promise<{ inc: number; exp: number }> {
  const [r] = await adminQuery<{ inc: string; exp: string }>(
    `select coalesce(sum(l.amount) filter (where e.kind = 'income'), 0)::text as inc,
            coalesce(sum(l.amount) filter (where e.kind = 'expense'), 0)::text as exp
       from app.entries e join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
      where e.space_id = $1 and e.voided_at is null`,
    [await spaceId('personal')],
  );
  if (!r) throw new Error('incomeExpense');
  return { inc: Number(r.inc), exp: Number(r.exp) };
}

/** `Kurang Rp …` di kartu Modal trading (0 bila kartu tidak memperingatkan). */
async function kurang(page: Page): Promise<number> {
  await page.goto('/pribadi/dompet');
  const status = main(page).getByRole('region', { name: 'Modal trading' }).getByRole('status');
  if ((await status.count()) === 0) return 0;
  return money(await txt(status.getByText(/^Kurang/)));
}

async function openUntil(open: () => Locator, sheet: Locator, field: Locator) {
  await expect(async () => {
    if ((await sheet.count()) === 0) await open().click();
    await expect(field).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

const dlg = (page: Page) => page.getByRole('dialog');
const detail = () => `/pribadi/dompet/${state.sek}`;
const topBtn = (page: Page, name: string) =>
  main(page).getByRole('button', { name, exact: true }).first();
const holding = (page: Page, t: string) => main(page).getByTestId(`holding-${t}`);
const openHolding = async (page: Page, t: string) => {
  const d = holding(page, t);
  if ((await d.getAttribute('open')) === null) await d.locator('summary').click();
  return d;
};

async function openTop(page: Page, name: string, field: string) {
  await page.goto(detail());
  await openUntil(
    () => topBtn(page, name),
    dlg(page),
    dlg(page).getByRole('textbox', { name: field }),
  );
  return dlg(page);
}

async function beli(
  page: Page,
  o: { ticker: string; lot: number; price: number; fee?: number; from: string; more?: boolean },
) {
  await page.goto(detail());
  if (o.more === true) await openHolding(page, o.ticker);
  const sheet = dlg(page);
  await openUntil(
    () =>
      o.more === true
        ? holding(page, o.ticker).getByRole('button', { name: `Beli lagi ${o.ticker}` })
        : topBtn(page, 'Beli saham'),
    sheet,
    sheet.getByRole('textbox', { name: 'Jumlah' }),
  );
  if (o.more !== true) await sheet.getByRole('textbox', { name: 'Kode saham' }).fill(o.ticker);
  await sheet.getByRole('textbox', { name: 'Jumlah' }).fill(String(o.lot));
  await sheet.getByRole('textbox', { name: 'Harga per lembar' }).fill(String(o.price));
  if (o.fee !== undefined)
    await sheet.getByRole('textbox', { name: /Biaya broker/ }).fill(String(o.fee));
  await sheet.getByRole('combobox', { name: 'Dari dompet' }).selectOption({ label: o.from });
  await sheet.getByRole('button', { name: /^(Tetap simpan|Simpan) pembelian/ }).click();
  await expect(
    toasts(page).getByText(new RegExp(`^Beli ${o.ticker} ${String(o.lot)} lot dicatat`)),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function jual(
  page: Page,
  o: { ticker: string; lot: number; price: number; fee: number; tax: number; to: string },
) {
  await page.goto(detail());
  const sheet = dlg(page);
  await openUntil(
    () => topBtn(page, 'Jual saham'),
    sheet,
    sheet.getByRole('textbox', { name: 'Jumlah' }),
  );
  await sheet.getByRole('combobox', { name: 'Kode saham' }).selectOption(o.ticker);
  await sheet.getByRole('textbox', { name: 'Jumlah' }).fill(String(o.lot));
  await sheet.getByRole('textbox', { name: 'Harga per lembar' }).fill(String(o.price));
  await sheet.getByRole('textbox', { name: /Biaya broker/ }).fill(String(o.fee));
  await sheet.getByRole('textbox', { name: /Pajak jual/ }).fill(String(o.tax));
  await sheet.getByRole('combobox', { name: 'Ke dompet' }).selectOption({ label: o.to });
  const proceeds = o.lot * 100 * o.price - o.fee - o.tax;
  // Pratinjau dari server sebelum simpan (UI tidak menghitung sendiri).
  await expect(sheet.getByText(/Hasil bersih/)).toBeVisible({ timeout: 10_000 });
  await expect(sheet).toContainText(rpRe(proceeds));
  await sheet.getByRole('button', { name: 'Simpan penjualan' }).click();
  await expect(
    toasts(page).getByText(new RegExp(`^Jual ${o.ticker} ${String(o.lot)} lot dicatat`)),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return proceeds;
}

/** Tanggal ISO hari WIB `daysAgo` hari lalu (superuser; sama dengan tanggal yang dipakai server). */
async function dayAgo(daysAgo: number): Promise<string> {
  const [r] = await adminQuery<{ d: string }>('select (app.today() - $1::int)::text as d', [
    daysAgo,
  ]);
  return r?.d ?? '';
}

async function isiHarga(
  page: Page,
  ticker: string,
  close: number,
  o: { confirm: boolean; daysAgo?: number } = { confirm: false },
) {
  await page.goto(detail());
  const sheet = dlg(page);
  const field = sheet.getByRole('textbox', { name: 'Harga penutupan per lembar' });
  await openUntil(() => topBtn(page, 'Isi harga'), sheet, field);
  const code = sheet.getByRole('combobox', { name: 'Kode saham' });
  if ((await code.count()) > 0) await code.selectOption(ticker);
  await field.fill(String(close));
  if (o.daysAgo !== undefined)
    await sheet.getByLabel('Tanggal harga').fill(await dayAgo(o.daysAgo));
  await sheet.getByRole('button', { name: 'Simpan harga' }).click();
  if (o.confirm) {
    const box = sheet.getByRole('checkbox', { name: 'Ya, harga ini benar' });
    await expect(box).toBeVisible({ timeout: 10_000 });
    await box.check();
    await sheet.getByRole('button', { name: 'Simpan harga' }).click();
  }
}

test('siapkan dompet Bank, RDN trading dengan modal, dan dompet saham (jenis Saham)', async ({
  page,
}) => {
  await addWallet(page, 'pribadi', BANK, 50_000_000);
  await page.goto('/pribadi/dompet?tambah=1');
  const tambah = page.getByRole('dialog', { name: /Tambah dompet/ });
  await tambah.getByRole('textbox', { name: 'Nama' }).fill(RDN);
  await tambah.getByRole('radio', { name: 'Trading' }).click();
  await tambah.getByRole('button', { name: 'Simpan dompet' }).click();
  await expect(toasts(page).getByText(`Dompet ${RDN} ditambahkan di Pribadi`)).toBeVisible();
  const [rdn] = await adminQuery<{ id: string }>(
    'select id::text from app.accounts where name = $1',
    [RDN],
  );
  state.rdn = rdn?.id ?? '';

  // Setor modal lewat sheet yang sudah ada (bukan pemasukan/pengeluaran).
  const before = await incomeExpense();
  await page.goto(`/pribadi/dompet/${state.rdn}`);
  const sheet = page.getByRole('dialog', { name: /^Setor modal/ });
  await openUntil(
    () => main(page).getByRole('button', { name: 'Setor modal' }),
    sheet,
    sheet.getByRole('textbox', { name: 'Nominal' }),
  );
  await sheet.getByRole('combobox', { name: 'Dari dompet' }).selectOption({ label: BANK });
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill(String(MODAL));
  await sheet.getByRole('button', { name: /^Simpan/ }).click();
  await expect(
    toasts(page).getByText(new RegExp(`Modal disetor ke ${RDN} · Pribadi · ${rpRe(MODAL).source}`)),
  ).toBeVisible();
  expect(await balanceOf(RDN)).toBe(MODAL);
  expect(await incomeExpense()).toEqual(before);

  // Dompet saham: jenis Saham tanpa nilai awal; sesudah disimpan menuju Detail dompet saham.
  await page.goto('/pribadi/dompet');
  const add = page.getByRole('dialog', { name: /^Tambah aset/ });
  await openUntil(
    () =>
      main(page)
        .getByRole('button', { name: /Tambah aset/ })
        .first(),
    add,
    add.getByLabel('Jenis aset'),
  );
  await add.getByLabel('Jenis aset').selectOption('saham');
  await expect(add.getByRole('textbox', { name: 'Nilai sekarang' })).toHaveCount(0);
  await add.getByRole('textbox', { name: 'Nama' }).fill(SEK);
  await add.getByRole('button', { name: 'Simpan aset' }).click();
  await expect(toasts(page).getByText(`Aset ${SEK} ditambahkan di Pribadi`)).toBeVisible();
  await expect(page).toHaveURL(/\/pribadi\/dompet\/[0-9a-f-]{36}$/);
  state.sek = new URL(page.url()).pathname.split('/').pop() ?? '';
  await expect(main(page).getByText('Belum ada saham').first()).toBeVisible();
  const kind = await adminQuery<{ asset_kind: string }>(
    'select d.asset_kind from app.asset_details d join app.accounts a on a.id = d.account_id where a.name = $1',
    [SEK],
  );
  expect(kind).toEqual([{ asset_kind: 'saham' }]);
});

test(
  'Beli 2 lot lalu 1 lot BBCA dengan dua harga: biaya rata-rata, saldo buku = biaya, modal trading tidak bergeser (K7)',
  { tag: ['@T11'] },
  async ({ page }) => {
    const sums = await incomeExpense();
    const nw0 = await sqlNetWorth();
    const k0 = await kurang(page);

    await beli(page, { ticker: 'BBCA', lot: 2, price: 9150, fee: 1000, from: RDN });
    await beli(page, { ticker: 'BBCA', lot: 1, price: 9300, from: RDN, more: true });

    // 200*9150 + 1000 + 100*9300 = 2.761.000 untuk 300 lembar; rata-rata floor(2.761.000/300) = 9.203.
    const COST = 2_761_000;
    expect(await balanceOf(RDN)).toBe(MODAL - COST);
    expect(await balanceOf(SEK)).toBe(COST);
    expect(await incomeExpense()).toEqual(sums);
    expect(await sqlNetWorth()).toBe(nw0);
    expect(await kurang(page)).toBe(k0);

    await page.goto(detail());
    await expect(
      main(page)
        .getByText(`Biaya beli ${rp(COST)}`)
        .first(),
    ).toBeVisible();
    const row = await openHolding(page, 'BBCA');
    await expect(row).toContainText(/300 lembar\s*·\s*3 lot/);
    await expect(row).toContainText('Rata-rata Rp 9.203');
    await expect(row).toContainText('Belum ada harga');
    await expect(row).toContainText('sebesar biaya beli');
    await expect(row.getByText('Beli 2 lot @ Rp 9.150')).toBeVisible();
    await expect(row.getByText('Beli 1 lot @ Rp 9.300')).toBeVisible();

    // Tanpa harga: kekayaan bersih memakai biaya beli dan menyebutnya.
    const h = await hero(page);
    expect(h.total).toBe(nw0);
    expect(h.parts.Saham).toBe(COST);
    await expect(
      main(page).getByText('Sebagian saham belum ada harga, jadi dinilai sebesar biaya beli.'),
    ).toBeVisible();
    // Baris dompet saham di daftar Dompet: nilai dari SQL (sebesar biaya beli).
    const link = main(page).getByRole('link', { name: new RegExp(`^${SEK}`) });
    await expect(link).toContainText(rp(COST));
  },
);

test(
  'Isi harga: nilai pasar, untung belum terealisasi, kekayaan bersih; lonjakan minta konfirmasi',
  { tag: ['@T11'] },
  async ({ page }) => {
    const COST = 2_761_000;
    const nw0 = await sqlNetWorth();
    // Harga pertama kemarin (pembanding validator hanya harga `ok` yang lebih awal dari tanggalnya).
    await isiHarga(page, 'BBCA', 9800, { confirm: false, daysAgo: 1 });
    await expect(toasts(page).getByText(/^Harga BBCA .* disimpan$/)).toBeVisible();
    // 300 lembar x 9.800 = 2.940.000 (untung belum terealisasi 179.000).
    const MARKET = 300 * 9800;
    expect(await sqlNetWorth()).toBe(nw0 + (MARKET - COST));
    await page.goto(detail());
    await expect(main(page).getByText(rp(MARKET)).first()).toBeVisible();
    await expect(main(page).getByText(/Belum terealisasi \+Rp\s179\.000 untung/)).toBeVisible();
    const row = await openHolding(page, 'BBCA');
    await expect(row).toContainText('Harga Rp 9.800');
    const h = await hero(page);
    expect(h.parts.Saham).toBe(MARKET);
    expect(h.total).toBe(nw0 + (MARKET - COST));
    await expect(main(page).getByText(/^Harga saham /)).toBeVisible();

    // Lonjakan > 35% (9.800 -> 20.000): diminta konfirmasi; tanpa konfirmasi tidak tersimpan.
    await isiHarga(page, 'BBCA', 20_000);
    const sheet = dlg(page);
    await expect(sheet.getByRole('checkbox', { name: 'Ya, harga ini benar' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(sheet).toContainText('berubah lebih dari 35%');
    const rows = await adminQuery<{ close: string }>(
      "select close::text from app.stock_prices where ticker = 'BBCA'",
    );
    expect(rows.map((r) => r.close)).toEqual(['9800']);
    await page.keyboard.press('Escape');
    expect(await sqlNetWorth()).toBe(nw0 + (MARKET - COST));

    // Dikonfirmasi: harga dipakai (300 x 20.000), lalu kembali ke 9.800 (tidak lagi melonjak dari harga kemarin) tanpa konfirmasi.
    await isiHarga(page, 'BBCA', 20_000, { confirm: true });
    await expect(
      toasts(page)
        .getByText(/^Harga BBCA .* disimpan$/)
        .last(),
    ).toBeVisible();
    await expect.poll(() => sqlNetWorth()).toBe(nw0 + (300 * 20_000 - COST));
    await isiHarga(page, 'BBCA', 9800);
    await expect.poll(() => sqlNetWorth()).toBe(nw0 + (MARKET - COST));
  },
);

test(
  'Jual 1 lot (untung): hasil bersih dari server, P/L terealisasi, Laporan tetap; Batalkan jual membalik tepat sekali',
  { tag: ['@T11', '@I6'] },
  async ({ page }) => {
    const sums = await incomeExpense();
    const nw0 = await sqlNetWorth();
    const rdn0 = await balanceOf(RDN);
    await page.goto('/pribadi/laporan');
    const laporan0 = await txt(page.getByTestId('laporan-ringkasan'));

    const proceeds = await jual(page, {
      ticker: 'BBCA',
      lot: 1,
      price: 9900,
      fee: 2000,
      tax: 1000,
      to: RDN,
    });
    // cost_removed = floor(2.761.000 x 100 / 300) = 920.333; untung = 987.000 - 920.333 = 66.667.
    const REMOVED = 920_333;
    expect(proceeds).toBe(987_000);
    expect(await balanceOf(RDN)).toBe(rdn0 + proceeds);
    expect(await balanceOf(SEK)).toBe(2_761_000 - REMOVED);
    expect(await incomeExpense()).toEqual(sums);
    await page.goto(detail());
    await expect(
      main(page)
        .getByText(/Sudah terealisasi \+Rp\s66\.667 untung/)
        .first(),
    ).toBeVisible();
    const row = await openHolding(page, 'BBCA');
    await expect(row).toContainText(/200 lembar\s*·\s*2 lot/);
    await expect(row.getByText('Jual 1 lot @ Rp 9.900')).toBeVisible();
    await page.goto('/pribadi/laporan');
    expect(await txt(page.getByTestId('laporan-ringkasan'))).toBe(laporan0);

    // Batalkan transaksi terakhir (jual): lembar, biaya, saldo kembali; sekali saja.
    await page.goto(detail());
    const open = await openHolding(page, 'BBCA');
    const alert = page.getByRole('alertdialog');
    await openUntil(
      () => open.getByRole('button', { name: 'Batalkan transaksi BBCA terakhir' }),
      alert,
      alert.getByRole('button', { name: 'Batalkan transaksi' }),
    );
    await expect(alert).toContainText('Batalkan transaksi saham terakhir?');
    await alert.getByRole('button', { name: 'Batalkan transaksi' }).click();
    await expect(toasts(page).getByText('Transaksi BBCA dibatalkan')).toBeVisible();
    expect(await balanceOf(RDN)).toBe(rdn0);
    expect(await balanceOf(SEK)).toBe(2_761_000);
    expect(await incomeExpense()).toEqual(sums);
    await expect.poll(() => sqlNetWorth()).toBe(nw0);
    await page.goto(detail());
    await expect(
      (await openHolding(page, 'BBCA')).getByText(/300 lembar\s*·\s*3 lot/),
    ).toBeVisible();
    await expect(main(page).getByText(/Sudah terealisasi/)).toHaveCount(0);
  },
);

test(
  'Jual 1 lot (rugi), jual lebih dari yang dimiliki ditolak, Saham yang sudah dimiliki tanpa efek kas',
  { tag: ['@T11'] },
  async ({ page }) => {
    const sums = await incomeExpense();
    const rdn0 = await balanceOf(RDN);
    const bank0 = await balanceOf(BANK);

    // 100 x 9.000 = 900.000 hasil, biaya beli yang keluar 920.333: rugi 20.333.
    await jual(page, { ticker: 'BBCA', lot: 1, price: 9000, fee: 0, tax: 0, to: RDN });
    expect(await balanceOf(RDN)).toBe(rdn0 + 900_000);
    await page.goto(detail());
    await expect(
      main(page)
        .getByText(/Sudah terealisasi −Rp\s20\.333 rugi/)
        .first(),
    ).toBeVisible();

    // Jual lebih dari 2 lot yang tersisa: ditolak server, tidak ada entri.
    const sheet = await openTop(page, 'Jual saham', 'Jumlah');
    await sheet.getByRole('combobox', { name: 'Kode saham' }).selectOption('BBCA');
    await sheet.getByRole('textbox', { name: 'Jumlah' }).fill('3');
    await sheet.getByRole('textbox', { name: 'Harga per lembar' }).fill('9800');
    await sheet.getByRole('button', { name: 'Simpan penjualan' }).click();
    await expect(sheet.getByText('Jumlahnya melebihi saham yang dimiliki.')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await balanceOf(RDN)).toBe(rdn0 + 900_000);

    // Saham yang sudah dimiliki (250 lembar ASII @ 5.000): tanpa efek kas, masuk kekayaan bersih.
    const nw0 = await sqlNetWorth();
    const open = await openTop(page, 'Saham yang sudah dimiliki', 'Kode saham');
    await open.getByRole('textbox', { name: 'Kode saham' }).fill('ASII');
    await open.getByRole('radio', { name: 'Lembar' }).click();
    await open.getByRole('textbox', { name: 'Jumlah' }).fill('250');
    await open.getByRole('textbox', { name: 'Harga rata-rata per lembar' }).fill('5000');
    await open.getByRole('button', { name: 'Simpan saham' }).click();
    await expect(toasts(page).getByText(`ASII 250 lembar ditambahkan ke ${SEK}`)).toBeVisible();
    expect(await balanceOf(BANK)).toBe(bank0);
    expect(await balanceOf(RDN)).toBe(rdn0 + 900_000);
    expect(await incomeExpense()).toEqual(sums);
    expect(await sqlNetWorth()).toBe(nw0 + 1_250_000);
    await page.goto(detail());
    await expect(holding(page, 'ASII')).toContainText('250 lembar');
    await expect(holding(page, 'ASII')).toContainText('Belum ada harga');
    const h = await hero(page);
    expect(h.total).toBe(nw0 + 1_250_000);
  },
);

test(
  'arsip dompet saham berisi ditolak (account_has_holdings): kartu penjelasan, tanpa tombol, ditolak server',
  { tag: ['@T11'] },
  async ({ page }) => {
    await page.goto(detail());
    await expect(
      main(page).getByText(`${SEK} masih memegang saham. Jual semua saham dulu, lalu arsipkan.`),
    ).toBeVisible();
    await expect(main(page).getByRole('button', { name: /^Arsipkan/ })).toHaveCount(0);
    const { uid } = await spaceOf(OWNER, 'personal');
    await expect(
      asUser(uid, 'select api.archive_account(p_account_id => $1)', [state.sek]),
    ).rejects.toThrow(/account_has_holdings/);
    const [r] = await adminQuery<{ archived: boolean }>(
      'select archived_at is not null as archived from app.accounts where id = $1',
      [state.sek],
    );
    expect(r?.archived).toBe(false);
  },
);

test(
  'Modal trading: tanpa Kurang palsu sesudah beli saham; Kurang total = rugi terealisasi; menyebut Saham (biaya beli) (K7)',
  { tag: ['@T11', '@T10'] },
  async ({ page }) => {
    // Sisa modal 20.000.000 (setor) vs saldo trading + biaya beli saham. Posisi sekarang: BBCA 2 lot
    // (biaya 1.840.667) + ASII 250 lembar (biaya 1.250.000); RDN = 20.000.000 - 2.761.000 + 900.000.
    // Tanpa K7 setiap beli terbaca "tarik modal"; dengan K7 hanya rugi jual BBCA (20.333) yang kurang.
    const [t] = await adminQuery<{ stock_cost: string; balance: string }>(
      `select (select sum(cost_total)::text from app.stock_positions where space_id = $1) as stock_cost,
              b.balance::text as balance
         from app.account_balances b where b.account_id = $2`,
      [await spaceId('personal'), state.rdn],
    );
    expect(Number(t?.balance)).toBe(MODAL - 2_761_000 + 900_000);
    await page.goto('/pribadi/dompet');
    const card = main(page).getByRole('region', { name: 'Modal trading' });
    await expect(card).toContainText('Saham (biaya beli)');
    await expect(card).toContainText(rpRe(Number(t?.stock_cost)));
    await expect(card).toContainText('Dihitung dengan biaya beli, bukan nilai pasar');
    // Σ sisa modal semua dompet trading dikurangi saldo dan biaya beli saham (baris total SQL).
    const { uid, sid } = await spaceOf(OWNER, 'personal');
    const [tot] = await asUser<{ shortfall: string }>(
      uid,
      'select shortfall::text from api.trading_overview($1) where account_id is null',
      [sid],
    );
    const status = card.getByRole('status');
    if (Number(tot?.shortfall) > 0) {
      await expect(status).toContainText(rpRe(Number(tot?.shortfall)));
      await expect(status).toContainText('biaya beli saham');
    } else {
      await expect(status).toHaveCount(0);
    }
  },
);

test('axe 0 serious/critical, tanpa gulir horizontal di 320: Detail dompet saham dan semua sheet saham', async ({
  page,
  browser,
  ownerState,
}) => {
  test.setTimeout(300_000);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const url of ['/pribadi/dompet', detail()]) {
      await page.goto(url);
      await expect(main(page).getByRole('heading', { level: 1 })).toBeVisible();
      if (url === detail()) {
        for (const t of ['BBCA', 'ASII']) await openHolding(page, t);
      }
      if (width === 320) await noHorizontalScroll(page);
      await expectNoSeriousViolations(page);
    }
  }
  await page.setViewportSize({ width: 320, height: 640 });
  const sheets: [string, string][] = [
    ['Beli saham', 'Kode saham'],
    ['Jual saham', 'Jumlah'],
    ['Isi harga', 'Harga penutupan per lembar'],
    ['Saham yang sudah dimiliki', 'Kode saham'],
  ];
  for (const [button, field] of sheets) {
    await page.goto(detail());
    const sheet = dlg(page);
    await openUntil(() => topBtn(page, button), sheet, sheet.getByRole('textbox', { name: field }));
    await noHorizontalScroll(page);
    await expectNoSeriousViolations(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  // Dialog batal transaksi terakhir (alertdialog).
  await page.goto(detail());
  const open = await openHolding(page, 'ASII');
  const alert = page.getByRole('alertdialog');
  await openUntil(
    () => open.getByRole('button', { name: 'Batalkan transaksi ASII terakhir' }),
    alert,
    alert.getByRole('button', { name: 'Kembali' }),
  );
  await noHorizontalScroll(page);
  await expectNoSeriousViolations(page);
  await alert.getByRole('button', { name: 'Kembali' }).click();

  for (const url of ['/pribadi/dompet', detail()]) {
    await expectRouteBudget(browser, ownerState, url);
  }
});
