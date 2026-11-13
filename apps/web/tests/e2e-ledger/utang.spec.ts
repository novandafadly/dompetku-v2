import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../e2e/axe';
import { noHorizontalScroll } from '../e2e-auth/helpers';
import { adminQuery, expect, test } from './fixtures';
import {
  addWallet,
  bersamaResponses,
  digits,
  expectRouteBudget,
  spaceId,
  toasts,
  walletBalance,
} from './helpers';

/**
 * S11 Task 8 mode nyata: Rencana > Utang. Tambah utang (kontak baru inline, klik ganda = satu
 * utang), cicilan 25% / 50% / Lunas lewat sheet Bayar, Batalkan satu cicilan, piutang (arah
 * sebaliknya), utang berjalan (saldo nol efek), bayar melebihi sisa ditolak + `Bayar sisa`, Ubah
 * tanpa efek, Hapus utang + Pulihkan, Transaksi (pokok/cicilan), Laporan "Tidak termasuk", Menu →
 * Kontak (ganti nama, arsip), Bersama tanpa Utang/Kontak, axe, dan budget JS. Spec ini MENGISI data
 * dan tidak membersihkannya: project `data` (`playwright.ledger.config.ts`). Satu urutan serial
 * dengan data sendiri (nama unik).
 */
test.describe.configure({ mode: 'serial' });

const main = (page: Page) => page.getByRole('main');
const WALLET = 'Dompet Utang N';
const BUDI = 'Budi Utang E2E';
const CITRA = 'Citra Piutang E2E';
const SARI = 'Ibu Sari E2E';
const SARI_BARU = 'Ibu Sari E2E Baru';
const EKO = 'Eko Hapus E2E';
const DANI = 'Dani Arsip E2E';
const BUDI_TITLE = 'Modal usaha';
const rp = (n: number) => `Rp ${digits(n)}`;
/** Rp dengan spasi biasa maupun tak-pecah (MoneyText memakai keduanya di tempat berbeda). */
const rpRe = (n: number) => new RegExp(`Rp\\s${digits(n).replaceAll('.', '\\.')}`);

/** Kebenaran SQL periode gajian yang memuat hari ini; diisi di tes pertama, dibandingkan di Laporan. */
const state = { wallet0: 0, income: 0, expense: 0 };
const paths = { budi: '', eko: '' };

const addSheet = (page: Page) => page.getByRole('dialog', { name: /^Tambah utang/ });
const paySheet = (page: Page) =>
  page.getByRole('dialog', { name: /^(Bayar utang ke|Terima dari) / });
const editSheet = (page: Page) => page.getByRole('dialog', { name: /^Ubah utang/ });
const confirm = (page: Page) => page.getByRole('alertdialog');

async function openUntil(open: () => Locator, sheet: Locator, field: Locator) {
  await expect(async () => {
    if ((await sheet.count()) === 0) await open().click();
    await expect(field).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

/** Σ income dan expense (+fee) periode gajian hari ini di ruang Pribadi (SQL, bukan UI). */
async function truth(): Promise<{ income: number; expense: number }> {
  const [r] = await adminQuery<{ inc: string; exp: string }>(
    `with p as (select starts_on as s, ends_on as e from app.pay_period($1, app.today()))
     select coalesce((select sum(amount) from app.report_lines r, p where r.space_id = $1
                       and r.occurred_on between p.s and p.e and r.report_class = 'income'), 0)::text as inc,
            coalesce((select -sum(amount) from app.report_lines r, p where r.space_id = $1
                       and r.occurred_on between p.s and p.e
                       and r.report_class in ('expense', 'expense_fee')), 0)::text as exp`,
    [await spaceId('personal')],
  );
  if (!r) throw new Error('truth');
  return { income: Number(r.inc), expense: Number(r.exp) };
}

interface DebtRow {
  id: string;
  principal: string;
  voided: boolean;
  entries: number;
  paymentsLive: number;
  principalLive: number;
  /** Tiap entri utang: id, versi, tanggal, jumlah baris utama, status batal (urut id). */
  sig: string;
}

/** Baris utang kontak `name` + hitungan entrinya (superuser, hanya untuk asersi). */
async function debtOf(name: string): Promise<DebtRow> {
  const [r] = await adminQuery<DebtRow>(
    `select d.id::text, d.principal::text, d.voided_at is not null as voided,
            (select count(*)::int from app.entries e where e.debt_id = d.id) as entries,
            (select count(*)::int from app.entries e where e.debt_id = d.id
               and e.kind = 'debt_payment' and e.voided_at is null) as "paymentsLive",
            (select count(*)::int from app.entries e where e.debt_id = d.id
               and e.kind = 'debt_principal' and e.voided_at is null) as "principalLive",
            coalesce((select string_agg(e.id || ':' || e.version || ':' || e.occurred_on || ':'
                        || l.amount || ':' || (e.voided_at is not null), ',' order by e.id)
                        from app.entries e
                        join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                       where e.debt_id = d.id), '') as sig
       from app.debts d join app.contacts c on c.id = d.contact_id
      where c.name = $1`,
    [name],
  );
  if (!r) throw new Error(`utang ${name} tidak ada`);
  return r;
}

async function countOf(table: 'debts' | 'contacts', name: string): Promise<number> {
  const [r] = await adminQuery<{ n: number }>(
    table === 'contacts'
      ? 'select count(*)::int as n from app.contacts where name = $1'
      : `select count(*)::int as n from app.debts d join app.contacts c on c.id = d.contact_id
          where c.name = $1`,
    [name],
  );
  return r?.n ?? 0;
}

async function openAdd(page: Page): Promise<Locator> {
  await page.goto('/pribadi/rencana?bagian=utang');
  const sheet = addSheet(page);
  await openUntil(
    () => main(page).getByRole('button', { name: 'Tambah utang' }).first(),
    sheet,
    sheet.getByRole('radio', { name: 'Saya berutang' }),
  );
  return sheet;
}

/** Isi sheet Tambah utang; `contact` = nama kontak baru (inline). Belum menyimpan. */
async function fillAdd(
  sheet: Locator,
  a: {
    direction: 'borrowed' | 'lent';
    contact: string;
    amount: number;
    mode?: 'baru' | 'berjalan';
    title?: string;
    wallet?: string;
  },
) {
  await sheet
    .getByRole('radio', { name: a.direction === 'lent' ? 'Piutang' : 'Saya berutang' })
    .click();
  // Sudah ada kontak: kolom pilihan + `Tambah kontak baru` yang menukarnya dengan kolom nama.
  const baru = sheet.getByRole('button', { name: 'Tambah kontak baru' });
  if ((await baru.count()) > 0) await baru.click();
  await sheet.getByRole('textbox', { name: 'Nama kontak' }).fill(a.contact);
  if (a.title !== undefined) await sheet.getByRole('textbox', { name: /^Untuk apa/ }).fill(a.title);
  if (a.mode === 'berjalan') await sheet.getByRole('radio', { name: 'Sudah berjalan' }).click();
  await sheet
    .getByRole('textbox', { name: a.mode === 'berjalan' ? 'Sisa saat ini' : 'Jumlah pinjaman' })
    .fill(String(a.amount));
  if (a.mode !== 'berjalan') {
    await sheet
      .getByRole('combobox', { name: /^(Uang masuk ke|Uang keluar dari)$/ })
      .selectOption({ label: a.wallet ?? WALLET });
  }
}

async function addDebt(page: Page, a: Parameters<typeof fillAdd>[1], toast: string): Promise<void> {
  const sheet = await openAdd(page);
  await fillAdd(sheet, a);
  await sheet.getByRole('button', { name: 'Simpan utang', exact: true }).click();
  await expect(toasts(page).getByText(toast)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

const row = (page: Page, name: string) =>
  main(page).getByRole('listitem').filter({ hasText: name });

/** Buka detail utang `name` dari daftar Utang. */
async function openDetail(page: Page, name: string, heading: RegExp) {
  await page.goto('/pribadi/rencana?bagian=utang');
  await row(page, name).first().getByRole('link').first().click();
  await expect(page).toHaveURL(/\/pribadi\/rencana\/utang\/[0-9a-f-]{36}/);
  await expect(main(page).getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

async function openPay(page: Page, button: Locator) {
  const sheet = paySheet(page);
  await openUntil(
    () => button,
    sheet,
    sheet.getByRole('textbox', { name: /^Jumlah (dibayar|diterima)$/ }),
  );
  return sheet;
}

/** Kotak `Sisa` kartu utama detail (label + nominal), bukan riwayat pembayaran. */
const sisaBox = (page: Page) => main(page).getByText('Sisa', { exact: true }).locator('xpath=..');

const detailPay = (page: Page) =>
  main(page).getByRole('button', { name: /^(Bayar utang|Terima pembayaran)$/ });

async function payQuick(
  page: Page,
  quick: RegExp,
  footer: RegExp,
  toast: string | RegExp,
  { double = false }: { double?: boolean } = {},
) {
  const sheet = await openPay(page, detailPay(page));
  await sheet.getByRole('radio', { name: quick }).click();
  const save = sheet.getByRole('button', { name: footer });
  if (double) await save.dblclick();
  else await save.click();
  // Klik ganda: tepat satu toast (satu cicilan), bukan dua.
  await expect(toasts(page).getByText(toast)).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test(
  'tambah utang baru dengan kontak baru inline: saldo naik, klik ganda Simpan = satu utang',
  {
    tag: ['@C6'],
  },
  async ({ page }) => {
    await addWallet(page, 'pribadi', WALLET, 2_000_000);
    state.wallet0 = await walletBalance(page, 'pribadi', WALLET);
    Object.assign(state, await truth());

    await page.goto('/pribadi/rencana?bagian=utang');
    // Belum ada utang: keadaan kosong menawarkan Tambah utang (spec lain tidak membuat utang).
    const sheet = await openAdd(page);
    await expect(sheet.getByRole('textbox', { name: 'Nama kontak' })).toBeVisible();
    // Arah tanpa bawaan: Simpan tanpa memilih arah = galat kolom, tanpa efek.
    await sheet.getByRole('button', { name: 'Simpan utang', exact: true }).click();
    await expect(sheet.getByRole('alert').filter({ hasText: 'Pilih arah utang.' })).toBeVisible();
    expect(await countOf('contacts', BUDI)).toBe(0);

    await fillAdd(sheet, {
      direction: 'borrowed',
      contact: BUDI,
      amount: 1_000_000,
      title: BUDI_TITLE,
    });
    await sheet.getByRole('button', { name: 'Simpan utang', exact: true }).dblclick();
    await expect(
      toasts(page).getByText(
        `Utang ke ${BUDI} dicatat di Pribadi · ${rp(1_000_000)} masuk ke ${WALLET}`,
      ),
    ).toHaveCount(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Klik ganda = satu kontak, satu utang, satu entri pokok; saldo naik tepat sekali.
    expect(await countOf('contacts', BUDI)).toBe(1);
    expect(await countOf('debts', BUDI)).toBe(1);
    const d = await debtOf(BUDI);
    expect(d.principal).toBe('1000000');
    expect(d.entries).toBe(1);
    expect(d.principalLive).toBe(1);
    paths.budi = `/pribadi/rencana/utang/${d.id}`;
    expect(await walletBalance(page, 'pribadi', WALLET)).toBe(state.wallet0 + 1_000_000);

    await page.goto('/pribadi/rencana?bagian=utang');
    const r = row(page, BUDI).first();
    await expect(r).toContainText(BUDI_TITLE);
    await expect(r).toContainText(rpRe(1_000_000));
    await expect(r).toContainText('0% terbayar');
    await expect(main(page).getByRole('region', { name: 'Sisa' })).toContainText(rpRe(1_000_000));
  },
);

test('cicilan 25% → 50% → Lunas lewat sheet Bayar: sisa, bilah, Lunas', async ({ page }) => {
  await page.goto(paths.budi);
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(`Utang ke ${BUDI}`);
  await expect(main(page)).toContainText('Belum ada pembayaran · dari Rp 1.000.000');

  // 25% dari sisa Rp 1.000.000.
  await payQuick(
    page,
    /^25% dari sisa, Rp 250\.000$/,
    /^Bayar Rp\s250\.000$/,
    `Dibayar ke ${BUDI} · ${rp(250_000)} dari ${WALLET} · sisa ${rp(750_000)}`,
  );
  await expect(main(page)).toContainText('25% terbayar · Rp 250.000 dari Rp 1.000.000');
  await expect(sisaBox(page)).toContainText(rpRe(750_000));
  expect(await walletBalance(page, 'pribadi', WALLET)).toBe(state.wallet0 + 750_000);

  // 50% dari sisa baru (Rp 750.000).
  await page.goto(paths.budi);
  await payQuick(
    page,
    /^50% dari sisa, Rp 375\.000$/,
    /^Bayar Rp\s375\.000$/,
    `Dibayar ke ${BUDI} · ${rp(375_000)} dari ${WALLET} · sisa ${rp(375_000)}`,
  );
  await expect(main(page)).toContainText('62% terbayar · Rp 625.000 dari Rp 1.000.000');
  await expect(sisaBox(page)).toContainText(rpRe(375_000));
  expect(await walletBalance(page, 'pribadi', WALLET)).toBe(state.wallet0 + 375_000);

  // Lunas: pintasan sama dengan sisa, tombol menjadi `Lunasi`.
  await page.goto(paths.budi);
  const sheet = await openPay(page, detailPay(page));
  await sheet.getByRole('radio', { name: /^Lunas, Rp 375\.000$/ }).click();
  await expect(sheet.getByRole('textbox', { name: 'Jumlah dibayar' })).toHaveValue('375.000');
  // Kolom `Setelah ini`: sisa sesudahnya Lunas, bukan Rp 0.
  await expect(sheet).toContainText('Sisa sesudahnya');
  await expect(sheet.getByText('Rp 0')).toHaveCount(0);
  await sheet.getByRole('button', { name: /^Lunasi Rp\s375\.000$/ }).click();
  await expect(
    toasts(page).getByText(`Utang ke ${BUDI} lunas · ${rp(375_000)} dari ${WALLET}`),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await expect(main(page)).toContainText('Rp 1.000.000 terbayar penuh');
  await expect(main(page).getByText('Lunas', { exact: true }).first()).toBeVisible();
  await expect(detailPay(page)).toHaveCount(0);
  expect(await walletBalance(page, 'pribadi', WALLET)).toBe(state.wallet0);
  const d = await debtOf(BUDI);
  expect(d.paymentsLive).toBe(3);

  // Daftar: Lunas bukan baris terbuka dan tidak pernah `Rp 0`.
  await page.goto('/pribadi/rencana?bagian=utang');
  await expect(main(page).getByText('Lunas (1)')).toBeVisible();
  await expect(main(page).getByRole('region', { name: 'Sisa' })).toHaveCount(0);
});

test(
  'Batalkan satu cicilan: sisa dan saldo kembali, riwayat menandai batal',
  {
    tag: ['@T8'],
  },
  async ({ page }) => {
    await page.goto(paths.budi);
    const item = main(page)
      .getByRole('listitem')
      .filter({ hasText: rp(250_000) });
    await item.getByRole('button', { name: /^Batalkan pembayaran / }).click();
    const dlg = confirm(page);
    await expect(dlg).toContainText('Batalkan pembayaran ini?');
    await dlg.getByRole('button', { name: 'Batalkan pembayaran', exact: true }).click();
    await expect(
      toasts(page).getByText(`Pembayaran dibatalkan · Pribadi · ${rp(250_000)}`),
    ).toBeVisible();
    await expect(dlg).toHaveCount(0);

    // Sisa bertambah Rp 250.000, bukan Lunas lagi; saldo dompet kembali Rp 250.000.
    await expect(sisaBox(page)).toContainText(rpRe(250_000));
    await expect(main(page)).toContainText('75% terbayar');
    await expect(main(page).getByText('Rp 1.000.000 terbayar penuh')).toHaveCount(0);
    const cancelled = main(page)
      .getByRole('listitem')
      .filter({ hasText: rp(250_000) });
    await expect(cancelled).toContainText('Dibatalkan');
    await expect(cancelled.getByRole('button', { name: /^Batalkan pembayaran / })).toHaveCount(0);
    expect(await walletBalance(page, 'pribadi', WALLET)).toBe(state.wallet0 + 250_000);
    expect((await debtOf(BUDI)).paymentsLive).toBe(2);
  },
);

test('piutang (arah sebaliknya): saldo turun, Terima sebagian lalu Lunas', async ({ page }) => {
  const before = await walletBalance(page, 'pribadi', WALLET);
  await addDebt(
    page,
    { direction: 'lent', contact: CITRA, amount: 600_000 },
    `Piutang pada ${CITRA} dicatat di Pribadi · ${rp(600_000)} keluar dari ${WALLET}`,
  );
  expect(await walletBalance(page, 'pribadi', WALLET)).toBe(before - 600_000);
  await page.goto('/pribadi/rencana?bagian=utang');
  await expect(main(page).getByRole('heading', { name: 'Piutang', exact: true })).toBeVisible();
  await expect(row(page, CITRA).first()).toContainText(rpRe(600_000));

  await openDetail(page, CITRA, new RegExp(`^Piutang pada ${CITRA}$`));
  const citraPath = new URL(page.url()).pathname;
  await payQuick(
    page,
    /^50% dari sisa, Rp 300\.000$/,
    /^Terima Rp\s300\.000$/,
    `Diterima dari ${CITRA} · ${rp(300_000)} di ${WALLET} · sisa ${rp(300_000)}`,
  );
  expect(await walletBalance(page, 'pribadi', WALLET)).toBe(before - 300_000);
  await page.goto(citraPath);
  const sheet = await openPay(page, detailPay(page));
  await sheet.getByRole('radio', { name: /^Lunas, Rp 300\.000$/ }).click();
  await sheet.getByRole('button', { name: /^Terima pelunasan Rp\s300\.000$/ }).click();
  await expect(
    toasts(page).getByText(`Piutang pada ${CITRA} lunas · ${rp(300_000)} di ${WALLET}`),
  ).toBeVisible();
  await expect(main(page)).toContainText('Rp 600.000 terbayar penuh');
  expect(await walletBalance(page, 'pribadi', WALLET)).toBe(before);
});

test('utang berjalan: sisa tercatat tanpa efek ke saldo dan tanpa entri', async ({ page }) => {
  const before = await walletBalance(page, 'pribadi', WALLET);
  await addDebt(
    page,
    { direction: 'borrowed', contact: SARI, amount: 2_000_000, mode: 'berjalan' },
    `Utang ke ${SARI} dicatat di Pribadi · saldo tidak berubah`,
  );
  expect(await walletBalance(page, 'pribadi', WALLET)).toBe(before);
  const d = await debtOf(SARI);
  expect(d.entries).toBe(0);
  expect(d.principal).toBe('2000000');
  await openDetail(page, SARI, new RegExp(`^Utang ke ${SARI}$`));
  await expect(main(page)).toContainText('Sudah berjalan');
  await expect(main(page)).toContainText('Saldo dompet tidak ikut berubah.');
  await expect(main(page)).toContainText(rpRe(2_000_000));
  await expect(main(page)).toContainText('Belum ada pembayaran.');
  // Utang yang belum ada kaitannya dengan Transaksi: tidak ada baris di daftar.
  await page.goto('/pribadi/transaksi');
  await expect(main(page).getByRole('link', { name: new RegExp(SARI) })).toHaveCount(0);
});

test(
  'bayar melebihi sisa: galat kolom, Bayar sisa hanya mengisi, tanpa efek',
  {
    tag: ['@T7'],
  },
  async ({ page }) => {
    const before = await walletBalance(page, 'pribadi', WALLET);
    await openDetail(page, SARI, new RegExp(`^Utang ke ${SARI}$`));
    const sheet = await openPay(page, detailPay(page));
    await sheet.getByRole('textbox', { name: 'Jumlah dibayar' }).fill('2500000');
    await expect(
      sheet.getByText('Jumlah ini lebih besar dari sisa. Kurangi jumlahnya atau bayar sisanya.'),
    ).toBeVisible();
    // Simpan tetap bisa ditekan, tetapi ditolak di klien (tanpa kirim) dan fokus kembali ke kolom.
    await sheet.getByRole('button', { name: /^Bayar Rp\s2\.500\.000$/ }).click();
    await expect(sheet.getByRole('textbox', { name: 'Jumlah dibayar' })).toBeFocused();
    expect((await debtOf(SARI)).paymentsLive).toBe(0);
    await expect(paySheet(page)).toBeVisible();

    // `Bayar sisa Rp …` mengisi kolom dengan sisa; belum menyimpan.
    await sheet.getByRole('button', { name: 'Bayar sisa Rp 2.000.000' }).click();
    await expect(sheet.getByRole('textbox', { name: 'Jumlah dibayar' })).toHaveValue('2.000.000');
    await expect(sheet.getByRole('button', { name: /^Lunasi Rp\s2\.000\.000$/ })).toBeVisible();
    expect((await debtOf(SARI)).paymentsLive).toBe(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await walletBalance(page, 'pribadi', WALLET)).toBe(before);
  },
);

test(
  'Ubah utang: judul dan catatan tanpa efek ke saldo, cicilan, atau sisa (utang yang sudah dicicil)',
  {
    tag: ['@T6', '@S4'],
  },
  async ({ page }) => {
    const before = await walletBalance(page, 'pribadi', WALLET);
    const d0 = await debtOf(BUDI);
    // Budi punya pokok, dua cicilan hidup, dan satu cicilan batal: empat entri (tiga hidup, satu batal).
    expect(d0.entries).toBe(4);
    await openDetail(page, BUDI, new RegExp(`^Utang ke ${BUDI}$`));
    await expect(sisaBox(page)).toContainText(rpRe(250_000));
    const sheet = editSheet(page);
    await openUntil(
      () => main(page).getByRole('button', { name: 'Ubah', exact: true }),
      sheet,
      sheet.getByRole('textbox', { name: /^Untuk apa/ }),
    );
    await sheet.getByRole('textbox', { name: /^Untuk apa/ }).fill(`${BUDI_TITLE} warung`);
    await sheet.getByRole('textbox', { name: /^Catatan/ }).fill('dari tabungan arisan');
    await sheet.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect(toasts(page).getByText(`Utang ke ${BUDI} disimpan · Pribadi`)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(main(page)).toContainText(`${BUDI_TITLE} warung`);
    await expect(main(page)).toContainText('dari tabungan arisan');
    // Sisa, bilah, dan riwayat tidak berubah.
    await expect(sisaBox(page)).toContainText(rpRe(250_000));
    await expect(main(page)).toContainText('75% terbayar');
    // Tiap entri: id, versi, tanggal, jumlah, status batal sama persis; judul tersimpan di utang.
    const d1 = await debtOf(BUDI);
    expect(d1.sig).toBe(d0.sig);
    expect({ ...d1 }).toEqual({ ...d0 });
    const [t] = await adminQuery<{ title: string; note: string }>(
      `select d.title, d.note from app.debts d join app.contacts c on c.id = d.contact_id
        where c.name = $1`,
      [BUDI],
    );
    expect(t).toEqual({ title: `${BUDI_TITLE} warung`, note: 'dari tabungan arisan' });
    expect(await walletBalance(page, 'pribadi', WALLET)).toBe(before);
  },
);

test(
  'Hapus utang membalik semua efek; Pulihkan dari Utang dihapus mengembalikannya',
  {
    tag: ['@T9', '@C6'],
  },
  async ({ page }) => {
    const before = await walletBalance(page, 'pribadi', WALLET);
    await addDebt(
      page,
      { direction: 'borrowed', contact: EKO, amount: 400_000 },
      `Utang ke ${EKO} dicatat di Pribadi · ${rp(400_000)} masuk ke ${WALLET}`,
    );
    await openDetail(page, EKO, new RegExp(`^Utang ke ${EKO}$`));
    paths.eko = new URL(page.url()).pathname;
    await payQuick(
      page,
      /^25% dari sisa, Rp 100\.000$/,
      /^Bayar Rp\s100\.000$/,
      `Dibayar ke ${EKO} · ${rp(100_000)} dari ${WALLET} · sisa ${rp(300_000)}`,
      { double: true },
    );
    // Klik ganda Bayar = satu cicilan (pokok + satu cicilan = 2 entri), saldo turun sekali.
    const paid = await debtOf(EKO);
    expect(paid.paymentsLive).toBe(1);
    expect(paid.entries).toBe(2);
    const mid = await walletBalance(page, 'pribadi', WALLET);
    expect(mid).toBe(before + 400_000 - 100_000);

    await page.goto(paths.eko);
    await main(page).getByRole('button', { name: 'Hapus utang' }).click();
    const dlg = confirm(page);
    await expect(dlg).toContainText(`Hapus utang ke ${EKO}?`);
    await expect(dlg).toContainText('Saldo dompet berubah');
    await dlg.getByRole('button', { name: 'Hapus utang', exact: true }).click();
    await expect(toasts(page).getByText(`Utang ke ${EKO} dihapus di Pribadi`)).toBeVisible();
    await expect(dlg).toHaveCount(0);
    // Pokok masuk Rp 400.000 dan cicilan Rp 100.000 keluar dibalik: saldo −Rp 300.000.
    expect(await walletBalance(page, 'pribadi', WALLET)).toBe(mid - 300_000);
    const gone = await debtOf(EKO);
    expect(gone.voided).toBe(true);
    expect(gone.paymentsLive + gone.principalLive).toBe(0);

    await page.goto('/pribadi/rencana?bagian=utang');
    await expect(row(page, EKO).filter({ has: page.getByRole('link') })).toHaveCount(0);
    await main(page)
      .getByText(/^Utang dihapus \(1\)$/)
      .click();
    await main(page)
      .getByRole('button', { name: `Pulihkan utang ke ${EKO}` })
      .click();
    await expect(toasts(page).getByText(`Utang ke ${EKO} dipulihkan di Pribadi`)).toBeVisible();
    expect(await walletBalance(page, 'pribadi', WALLET)).toBe(mid);
    const back = await debtOf(EKO);
    expect(back.voided).toBe(false);
    expect(back.paymentsLive).toBe(1);
    expect(back.principalLive).toBe(1);
    await page.goto('/pribadi/rencana?bagian=utang');
    await expect(row(page, EKO).first()).toContainText(rpRe(300_000));
  },
);

test('Transaksi: pokok dan cicilan utang tanpa Ubah/Pindah, pokok tanpa Batalkan', async ({
  page,
}) => {
  await page.goto('/pribadi/transaksi');
  const pokok = main(page).getByRole('link', {
    name: new RegExp(`${BUDI} · ${BUDI_TITLE}.*Pinjaman diterima`),
  });
  await expect(pokok).toHaveCount(1);
  await pokok.click();
  await expect(page).toHaveURL(/\/pribadi\/transaksi\/[0-9a-f-]{36}$/);
  await expect(main(page)).toContainText('Pinjaman diterima');
  await expect(main(page)).toContainText(BUDI);
  await expect(main(page)).toContainText('Pokok utang tidak dibatalkan sendiri.');
  for (const name of ['Ubah', 'Batalkan transaksi', /^Pindahkan ke /]) {
    await expect(main(page).getByRole('button', { name })).toHaveCount(0);
    await expect(main(page).getByRole('link', { name })).toHaveCount(0);
  }
  await main(page).getByRole('link', { name: 'Lihat utang' }).click();
  await expect(page).toHaveURL(new RegExp(`${paths.budi}$`));

  // Cicilan hidup: hanya Batalkan; tanpa Ubah/Pindah.
  await page.goto('/pribadi/transaksi');
  const cicilan = main(page).getByRole('link', {
    name: new RegExp(`${BUDI} · ${BUDI_TITLE}.*Pembayaran utang`),
  });
  await expect(cicilan.first()).toBeVisible();
  expect(await cicilan.count()).toBeGreaterThanOrEqual(2);
  await cicilan.first().click();
  await expect(main(page)).toContainText('Pembayaran utang');
  await expect(main(page).getByRole('button', { name: 'Batalkan transaksi' })).toBeVisible();
  for (const name of ['Ubah', /^Pindahkan ke /]) {
    await expect(main(page).getByRole('button', { name })).toHaveCount(0);
    await expect(main(page).getByRole('link', { name })).toHaveCount(0);
  }
  await noHorizontalScroll(page);
});

test('Laporan: pokok dan cicilan di "Tidak termasuk"; pemasukan dan pengeluaran tidak berubah', async ({
  page,
}) => {
  const t = await truth();
  expect(t).toEqual({ income: state.income, expense: state.expense });
  await page.goto('/pribadi/laporan');
  const ring = page.getByTestId('laporan-ringkasan');
  const text = async (l: Locator) => (await l.innerText()).replaceAll(' ', ' ');
  const r = await text(ring);
  // Tanda hanya muncul untuk nominal > 0 (`Rp 0` tanpa tanda): cukup nominalnya.
  expect(r).toContain(rp(t.income));
  expect(r).toContain(rp(t.expense));

  const excl = page.getByTestId('laporan-tidak-termasuk');
  const e = await text(excl);
  // Kelas dari SQL periode yang sama: setiap kelas utang yang ada tampil dengan namanya.
  const classes = await adminQuery<{ cls: string; sign: number; total: string }>(
    `with p as (select starts_on as s, ends_on as e from app.pay_period($1, app.today()))
     select r.report_class as cls, sign(r.amount)::int as sign, abs(sum(r.amount))::text as total
       from app.report_lines r, p
      where r.space_id = $1 and r.occurred_on between p.s and p.e
        and r.report_class in ('x_pokok_utang', 'x_pelunasan_utang')
      group by 1, 2`,
    [await spaceId('personal')],
  );
  const names: Record<string, string> = {
    'x_pokok_utang:1': 'Pinjaman diterima',
    'x_pokok_utang:-1': 'Pinjaman diberikan',
    'x_pelunasan_utang:-1': 'Pelunasan utang',
    'x_pelunasan_utang:1': 'Penerimaan piutang',
  };
  expect(classes.map((c) => names[`${c.cls}:${String(c.sign)}`]).sort()).toEqual(
    ['Penerimaan piutang', 'Pelunasan utang', 'Pinjaman diberikan', 'Pinjaman diterima'].sort(),
  );
  for (const c of classes) {
    const name = names[`${c.cls}:${String(c.sign)}`] ?? '';
    expect(e, name).toContain(name);
    expect(e, `${name} ${c.total}`).toContain(rp(Number(c.total)));
  }
  await expect(excl).toContainText('bukan pemasukan');
  await expect(excl).not.toContainText('Rp 0');
});

test('Menu → Kontak: tautan nyata di Pribadi; ganti nama, ringkasan sisa, arsip', async ({
  page,
}) => {
  await page.goto('/pribadi/beranda');
  await page.getByRole('button', { name: 'Menu' }).first().click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await expect(menu.getByRole('link', { name: 'Kontak' })).toBeVisible();
  await expect(menu.getByText('Segera')).not.toHaveCount(0); // butir lain tetap Segera
  await menu.getByRole('link', { name: 'Kontak' }).click();
  await expect(page).toHaveURL(/\/pribadi\/kontak$/);
  await expect(
    main(page).getByRole('heading', { level: 1, name: 'Kontak · Pribadi' }),
  ).toBeVisible();

  // Ringkasan sisa per kontak: Budi punya utang aktif, Citra lunas tanpa utang aktif.
  const contact = (name: string) =>
    main(page).getByRole('button', { name: new RegExp(`^Ubah kontak ${name}`) });
  await expect(contact(BUDI)).toContainText(`Saya berutang`);
  await expect(contact(BUDI)).toContainText(rpRe(250_000));
  await expect(contact(CITRA)).toContainText('Tidak ada utang aktif');
  await expect(contact(SARI)).toContainText(rpRe(2_000_000));

  // Tambah kontak tanpa utang, lalu arsipkan.
  await main(page).getByRole('button', { name: 'Tambah kontak' }).first().click();
  let sheet = page.getByRole('dialog', { name: /^Tambah kontak/ });
  await sheet.getByRole('textbox', { name: 'Nama' }).fill(DANI);
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(toasts(page).getByText(`Kontak ${DANI} disimpan · Pribadi`)).toBeVisible();
  await expect(contact(DANI)).toContainText('Tidak ada utang aktif');
  await contact(DANI).click();
  sheet = page.getByRole('dialog', { name: /^Ubah kontak/ });
  await sheet.getByRole('button', { name: 'Arsipkan kontak' }).click();
  const dlg = confirm(page);
  await expect(dlg).toContainText(`Arsipkan ${DANI}?`);
  await dlg.getByRole('button', { name: 'Arsipkan', exact: true }).click();
  await expect(toasts(page).getByText(`${DANI} diarsipkan`)).toBeVisible();
  await expect(contact(DANI)).toHaveCount(0);
  const [arch] = await adminQuery<{ archived: boolean }>(
    'select archived_at is not null as archived from app.contacts where name = $1',
    [DANI],
  );
  expect(arch?.archived).toBe(true);

  // Ganti nama: berlaku di daftar Utang, angka utang tidak berubah.
  const d0 = await debtOf(SARI);
  await contact(SARI).click();
  sheet = page.getByRole('dialog', { name: /^Ubah kontak/ });
  await sheet.getByRole('textbox', { name: 'Nama' }).fill(SARI_BARU);
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(toasts(page).getByText(`Kontak ${SARI_BARU} disimpan · Pribadi`)).toBeVisible();
  await expect(contact(SARI_BARU)).toContainText(rpRe(2_000_000));
  expect(await debtOf(SARI_BARU)).toEqual(d0);
  await page.goto('/pribadi/rencana?bagian=utang');
  await expect(row(page, SARI_BARU).first()).toContainText(rpRe(2_000_000));

  // Kontak terarsip tidak ditawarkan di pilihan kontak Tambah utang.
  const add = await openAdd(page);
  await expect(add.getByRole('combobox', { name: 'Kontak' })).not.toContainText(DANI);
  await expect(add.getByRole('combobox', { name: 'Kontak' })).toContainText(BUDI);
});

test('Bersama: tanpa segmen Utang, tanpa Kontak, rute utang 404, tanpa data Pribadi', async ({
  page,
}) => {
  const kanari = [BUDI, CITRA, SARI, SARI_BARU, EKO, BUDI_TITLE];
  const expectClean = ({ bodies, unread }: { bodies: string[]; unread: string[] }) => {
    expect(unread).toEqual([]);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) for (const k of kanari) expect(body.includes(k), k).toBe(false);
  };

  // `bagian=utang` di Bersama jatuh ke Anggaran: segmen hanya Anggaran dan Tagihan.
  expectClean(await bersamaResponses(page, () => page.goto('/bersama/rencana?bagian=utang')));
  const seg = page.getByRole('navigation', { name: 'Bagian Rencana' });
  await expect(seg.getByRole('link', { name: 'Anggaran' })).toBeVisible();
  await expect(seg.getByRole('link', { name: 'Utang' })).toHaveCount(0);
  await expect(main(page)).not.toContainText('Saya berutang');
  await expect(main(page)).not.toContainText('Tambah utang');

  // Menu Bersama: tanpa Kontak (tidak dirender, bukan nonaktif).
  await page.getByRole('button', { name: 'Menu' }).first().click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await expect(menu).toContainText('Sampah');
  await expect(menu.getByText('Kontak')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Rute Kontak dan detail utang di Bersama: halaman 404. Status stream bisa 200 (Suspense),
  // jadi yang diperiksa isi halamannya.
  for (const path of ['/bersama/kontak', paths.budi.replace('/pribadi/', '/bersama/')]) {
    expectClean(await bersamaResponses(page, () => page.goto(path)));
    await expect(page.getByRole('heading', { level: 1, name: '404' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Kontak · ');
    await expect(page.getByText(`Utang ke ${BUDI}`)).toHaveCount(0);
  }
  // Pribadi tetap menawarkan Kontak (kontrol positif atas Menu).
  await page.goto('/pribadi/beranda');
  await page.getByRole('button', { name: 'Menu' }).first().click();
  await expect(
    page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Kontak' }),
  ).toBeVisible();
});

test('axe: daftar Utang, detail, dan Kontak', async ({ page }) => {
  for (const url of ['/pribadi/rencana?bagian=utang', paths.budi, '/pribadi/kontak']) {
    await page.goto(url);
    await expect(main(page)).toBeVisible();
    await noHorizontalScroll(page);
    await expectNoSeriousViolations(page);
  }
});

test('budget JS: Utang, detail, Kontak, Rencana, Laporan, Transaksi, Beranda nyata ≤ 162 kB', async ({
  browser,
  ownerState,
}) => {
  for (const url of [
    '/pribadi/beranda',
    '/pribadi/transaksi',
    '/pribadi/rencana',
    '/pribadi/rencana?bagian=utang',
    paths.budi,
    '/pribadi/kontak',
    '/pribadi/laporan',
  ]) {
    await expectRouteBudget(browser, ownerState, url);
    const a = test.info().annotations.slice(-2);
    console.log(
      `BUDGET-S11 ${url}: ${a.map((x) => `${x.type} ${x.description ?? ''}`).join(', ')}`,
    );
  }
});
