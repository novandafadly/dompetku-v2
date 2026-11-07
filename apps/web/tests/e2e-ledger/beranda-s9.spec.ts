import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../e2e/axe';
import { noHorizontalScroll } from '../e2e-auth/helpers';
import { adminQuery, expect, test } from './fixtures';
import {
  addWallet,
  bersamaResponses,
  chipsOf,
  digits,
  expectRouteBudget,
  openCatat,
  spaceId,
  toasts,
} from './helpers';

/**
 * S9 Task 12 mode nyata: Beranda. Kartu Aman dipakai lengkap (periode gajian, status ikon + teks,
 * rincian tagihan + wajib), Tagihan 7 hari (termasuk lewat), Anggaran hampir habis (≥ 80%),
 * Beranda = Rencana untuk periode yang sama, Bersama tanpa data Pribadi, axe, dan budget JS. Satu
 * urutan serial dengan data sendiri (nama unik); berjalan sendiri atau sesudah spec lain.
 */
test.describe.configure({ mode: 'serial' });

const main = (page: Page) => page.getByRole('main');
const WALLET = 'Dompet Beranda N';
const BILL_LATE = 'Tagihan Lewat Beranda N';
const BILL_SOON = 'Tagihan Dekat Beranda N';
const KAT_BILL = 'Cicilan & Tagihan';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const billSheet = (page: Page) =>
  page.getByRole('dialog', { name: /^(Tagihan|Ubah tagihan)\s*(Pribadi|Bersama)$/ });
const budgetSheet = (page: Page) =>
  page.getByRole('dialog', { name: /^Anggaran\s*(Pribadi|Bersama)$/ });
const amanCard = (page: Page) => page.getByTestId('balance-card');
const billsCard = (page: Page) => main(page).getByRole('region', { name: 'Tagihan 7 hari' });
const budgetsCard = (page: Page) =>
  main(page).getByRole('region', { name: 'Anggaran hampir habis' });

let kategori = '';
let spent = 0;
let budget = 0;

async function openUntil(open: () => Locator, sheet: Locator, field: Locator) {
  await expect(async () => {
    if ((await sheet.count()) === 0) await open().click();
    await expect(field).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

async function today(): Promise<{ iso: string; day: number }> {
  const [r] = await adminQuery<{ iso: string; day: number }>(
    "select to_char(app.today(), 'YYYY-MM-DD') as iso, extract(day from app.today())::int as day",
  );
  if (!r) throw new Error('today');
  return r;
}

async function addBill(page: Page, name: string, amount: number, tanggal: number) {
  await page.goto('/pribadi/rencana?bagian=tagihan');
  const sheet = billSheet(page);
  await openUntil(
    () => main(page).getByRole('button', { name: 'Tambah tagihan' }).first(),
    sheet,
    sheet.getByRole('textbox', { name: 'Nama' }),
  );
  await sheet.getByRole('textbox', { name: 'Nama' }).fill(name);
  await sheet.getByRole('textbox', { name: 'Perkiraan nominal' }).fill(String(amount));
  await sheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: KAT_BILL });
  await sheet.getByRole('combobox', { name: 'Tanggal tiap bulan' }).selectOption(String(tanggal));
  await sheet.getByLabel('Mulai').fill(`${(await today()).iso.slice(0, 7)}-01`);
  await sheet.getByRole('button', { name: 'Simpan tagihan' }).click();
  await expect(toasts(page).getByText(`Tagihan ${name} disimpan · Pribadi`)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Satu pengeluaran lewat Catat (chip pertama); mengembalikan nama kategori chip itu. */
async function expense(page: Page, amount: number): Promise<string> {
  await page.goto('/pribadi/beranda');
  const sheet = await openCatat(page);
  await page.keyboard.type(String(amount));
  const chip = chipsOf(sheet).first();
  const name = ((await chip.innerText()) || '').trim().split('\n')[0] ?? '';
  await chip.click();
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page)
      .getByText(/Tersimpan di Pribadi/)
      .last(),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);
  return name;
}

test('anggaran wajib 85%: Anggaran hampir habis dan rincian Aman dipakai memuat sisa wajib', async ({
  page,
}) => {
  await addWallet(page, 'pribadi', WALLET, 5_000_000);
  kategori = await expense(page, 850_000);
  expect(kategori).not.toBe(KAT_BILL);
  const [sum] = await adminQuery<{ spent: string }>(
    `select coalesce(-sum(amount), 0)::text as spent from app.report_lines
      where space_id = $1 and root_category_id = (
        select id from app.categories where space_id = $1 and name = $2)
        and report_class = 'expense'`,
    [await spaceId('personal'), kategori],
  );
  spent = Number(sum?.spent ?? 0);
  expect(spent).toBeGreaterThanOrEqual(850_000);
  budget = Math.ceil(spent / 0.85 / 1000) * 1000;
  await page.goto('/pribadi/rencana');
  const sheet = budgetSheet(page);
  await openUntil(
    () =>
      main(page)
        .getByRole('button', { name: /^Atur anggaran/ })
        .first(),
    sheet,
    sheet.getByRole('textbox', { name: 'Anggaran periode ini' }),
  );
  await sheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: kategori });
  await sheet.getByRole('textbox', { name: 'Anggaran periode ini' }).fill(String(budget));
  await sheet.getByRole('switch', { name: 'Wajib' }).click();
  await sheet.getByRole('button', { name: 'Simpan anggaran' }).click();
  await expect(toasts(page).getByText(`Anggaran ${kategori} disimpan · Pribadi`)).toBeVisible();

  await page.goto('/pribadi/beranda');
  const card = budgetsCard(page);
  await expect(card).toContainText(kategori);
  await expect(card).toContainText(/[89]\d% terpakai/);
  await expect(card).toContainText('Wajib');
  await expect(card.getByRole('button')).toHaveCount(0);
  const table = amanCard(page).getByRole('table', { name: 'Rincian aman dipakai' });
  await expect(
    table.getByRole('rowheader', { name: /^Tagihan s\.d\. \d{1,2} \w{3}$/ }),
  ).toBeVisible();
  await expect(table.getByRole('rowheader', { name: 'Sisa anggaran wajib' })).toBeVisible();
  // Status memakai ikon + teks (bukan warna saja).
  await expect(amanCard(page).getByTestId('aman-status').locator('svg')).toHaveCount(1);
});

test('judul memakai akhir periode gajian dari SQL, bukan akhir bulan', async ({ page }) => {
  const [p] = await adminQuery<{ ends_on: string }>(
    `select to_char(ends_on, 'YYYY-MM-DD') as ends_on from app.pay_period($1, app.today())`,
    [await spaceId('personal')],
  );
  const [, m = '', d = ''] = (p?.ends_on ?? '').split('-');
  const expected = `${String(Number(d))} ${MONTHS[Number(m) - 1] ?? ''}`;
  await page.goto('/pribadi/beranda');
  await expect(
    amanCard(page).getByRole('heading', { name: `Aman dipakai sampai ${expected}` }),
  ).toBeVisible();
  await expect(
    amanCard(page).getByRole('rowheader', { name: `Tagihan s.d. ${expected}` }),
  ).toBeVisible();
});

test('Beranda = Rencana untuk periode yang sama (persen, terpakai, anggaran)', async ({ page }) => {
  await page.goto('/pribadi/beranda');
  const li = budgetsCard(page).locator('li').filter({ hasText: kategori });
  const home = (await li.innerText()).replaceAll(' ', ' ');
  await page.goto('/pribadi/rencana');
  const rencana = (
    await main(page).locator('[data-budget-row]').filter({ hasText: kategori }).innerText()
  ).replaceAll(' ', ' ');
  const pct = /(\d+)% terpakai/;
  expect(pct.exec(home)?.[1]).toBe(pct.exec(rencana)?.[1]);
  for (const t of [home, rencana]) {
    for (const part of [
      `Rp ${digits(spent)}`,
      `dari Rp ${digits(budget)}`,
      `sisa Rp ${digits(budget - spent)}`,
    ]) {
      expect(t).toContain(part);
    }
  }
});

test('tagihan lewat jatuh tempo: Hati-hati dengan sebab, tampil di Tagihan 7 hari', async ({
  page,
}) => {
  const t = await today();
  test.skip(t.day === 1, 'tanggal 1: jatuh tempo hari ini, bukan lewat');
  await addBill(page, BILL_LATE, 120_000, 1);
  await page.goto('/pribadi/beranda');
  const status = amanCard(page).getByTestId('aman-status');
  await expect(status).toContainText('Hati-hati');
  await expect(status).toContainText(/Ada \d+ tagihan lewat jatuh tempo\./);
  await expect(status.locator('svg')).toHaveCount(1);
  // Baris per hari tetap di luar kotak status.
  await expect(amanCard(page).getByText(/per hari untuk \d+ hari/)).toBeVisible();
  const card = billsCard(page);
  const row = card.locator('li').filter({ hasText: BILL_LATE });
  await expect(row).toContainText(`Lewat ${String(t.day - 1)} hari`);
  await expect(row).toContainText('Rp 120.000');
  await expect(card.getByRole('button')).toHaveCount(0);
  await card.getByRole('link', { name: /Semua\s+tagihan/ }).click();
  await expect(page).toHaveURL(/\/pribadi\/rencana\?bagian=tagihan$/);
  await expect(
    main(page).locator('[data-bill-row]').filter({ hasText: BILL_LATE }).first(),
  ).toBeVisible();
});

test('tagihan dalam 7 hari: label jatuh tempo', async ({ page }) => {
  const t = await today();
  test.skip(t.day > 26, 'tanggal jatuh tempo akan pindah bulan');
  await addBill(page, BILL_SOON, 75_000, t.day + 2);
  await page.goto('/pribadi/beranda');
  await expect(billsCard(page).locator('li').filter({ hasText: BILL_SOON })).toContainText(
    '2 hari lagi',
  );
});

test('rincian Aman dipakai memuat nominal tagihan dari SQL', async ({ page }) => {
  test.skip((await today()).day === 1, 'tagihan lewat tidak dibuat pada tanggal 1');
  await page.goto('/pribadi/beranda');
  const row = amanCard(page)
    .getByRole('rowheader', { name: /^Tagihan s\.d\./ })
    .locator('xpath=..');
  const m = /−Rp\s([\d.]+)/.exec((await row.innerText()).replaceAll('\u00a0', ' '));
  // Paling sedikit tagihan lewat 120.000 yang dibuat di atas.
  expect(Number((m?.[1] ?? '0').replaceAll('.', ''))).toBeGreaterThanOrEqual(120_000);
});

test('Bersama: kartu ada, tanpa data Pribadi (B13), kosong sesuai bingkai', async ({ page }) => {
  await addWallet(page, 'bersama', 'Dompet Beranda Bersama', 1_000_000);
  const { bodies, unread } = await bersamaResponses(page, async () => {
    await page.goto('/bersama/beranda');
    await expect(
      amanCard(page).getByRole('heading', { name: /^Aman dipakai bersama sampai/ }),
    ).toBeVisible();
    await expect(billsCard(page)).toBeVisible();
    await expect(budgetsCard(page)).toBeVisible();
  });
  expect(unread).toEqual([]);
  const all = bodies.join('\n');
  for (const secret of [BILL_LATE, BILL_SOON, WALLET]) expect(all).not.toContain(secret);
  const [shared] = await adminQuery<{ n: number }>(
    `select (select count(*) from app.bills where space_id = $1)::int as n`,
    [await spaceId('shared')],
  );
  if (shared?.n === 0) {
    await expect(billsCard(page)).toContainText('Belum ada tagihan.');
    await expect(billsCard(page).getByRole('link', { name: 'Tambah tagihan' })).toHaveAttribute(
      'href',
      '/bersama/rencana?bagian=tagihan',
    );
  }
});

test('axe, lebar 320 tanpa gulir samping, dua tema', async ({ page }) => {
  for (const [w, h] of [
    [320, 640],
    [390, 844],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const theme of ['dark', 'light']) {
      await page.goto(`/pribadi/beranda?theme=${theme}`);
      await expect(amanCard(page)).toBeVisible();
      await expectNoSeriousViolations(page);
      await noHorizontalScroll(page);
    }
  }
});

test('budget JS: Beranda, Transaksi, Rencana nyata ≤ 162 kB', async ({ browser, ownerState }) => {
  for (const url of ['/pribadi/beranda', '/pribadi/transaksi', '/pribadi/rencana']) {
    await expectRouteBudget(browser, ownerState, url);
  }
});
