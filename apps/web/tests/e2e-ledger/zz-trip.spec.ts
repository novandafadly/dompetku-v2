import type { Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../e2e/axe';
import { noHorizontalScroll } from '../e2e-auth/helpers';
import { adminQuery, expect, test } from './fixtures';
import {
  addWallet,
  catatSheet,
  digits,
  expectRouteBudget,
  openCatat,
  spaceId,
  toasts,
} from './helpers';

/**
 * S15 Task 11 mode nyata (e2e:ledger): Menu → Trip kosong → Tambah trip → Catat pengeluaran
 * dengan saran K9 → Detail trip (total, anggaran, rincian) → Kantor & Talangan tanpa pemilih →
 * Masukkan kandidat (anggaran terlampaui Lebih) → Keluarkan + Urungkan → Detail transaksi + Ubah +
 * Pindahkan catatan → Arsip + Pulihkan → I6 (Laporan/aman dipakai tetap) → CSV memuat kolom Trip →
 * 320 px, axe, budget JS.
 */
test.describe.configure({ mode: 'serial' });

const main = (page: Page) => page.getByRole('main');
const WALLET = 'Dompet Trip E2E';
const KANTOR = 'Kas Kantor Trip E2E';
const TRIP = 'Bali Trip E2E';
const rp = (n: number) => `Rp ${digits(n)}`;

function offsetDate(days: number): string {
  // Pakai zona WIB (+07:00) agar cocok dengan app.today() server.
  const nowWib = Date.now() + 7 * 3_600_000 + days * 86_400_000;
  return new Date(nowWib).toISOString().slice(0, 10);
}

const STARTS = offsetDate(-1);
const ENDS = offsetDate(5);

let tripHref = '';
let entryHref = '';

async function openAddTrip(page: Page) {
  const sheet = page.getByRole('dialog', { name: /^Tambah trip/ });
  await expect(async () => {
    if ((await sheet.count()) === 0) {
      await main(page).getByRole('button', { name: 'Tambah trip' }).first().click();
    }
    await expect(sheet.getByRole('textbox', { name: 'Nama trip' })).toBeVisible({ timeout: 2_000 });
  }).toPass();
  return sheet;
}

async function addKantorWallet(page: Page, name: string) {
  await page.goto('/pribadi/dompet?tambah=1');
  const sheet = page.getByRole('dialog', { name: /Tambah dompet/ });
  await sheet.getByRole('textbox', { name: 'Nama' }).fill(name);
  await sheet.getByRole('radio', { name: 'Kantor' }).click();
  await sheet.getByRole('textbox', { name: /Saldo/ }).fill('2000000');
  await sheet.getByRole('button', { name: 'Simpan dompet' }).click();
  await expect(toasts(page).getByText(new RegExp(`Dompet ${name} ditambahkan`))).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function totalPengeluaranSql(): Promise<number> {
  const [r] = await adminQuery<{ s: string }>(
    `select coalesce(sum(-l.amount), 0)::text as s
       from app.entries e join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
       join app.accounts a on a.id = l.account_id
      where e.space_id = $1 and e.voided_at is null and e.kind = 'expense'
        and not e.reimbursable and a.pocket <> 'kantor'`,
    [await spaceId('personal')],
  );
  return Number(r?.s ?? 0);
}

test('Menu → Trip kosong → Tambah trip (nama + tanggal + anggaran)', async ({ page }) => {
  await addWallet(page, 'pribadi', WALLET, 10_000_000);
  await addKantorWallet(page, KANTOR);

  await page.goto('/pribadi/beranda');
  await page.getByRole('button', { name: 'Menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  const link = menu.getByRole('link', { name: 'Trip' });
  await expect(link).toHaveAttribute('href', '/pribadi/trip');
  await link.click();

  await expect(main(page).getByRole('heading', { level: 1, name: 'Trip · Pribadi' })).toBeVisible();
  await expect(main(page).getByRole('heading', { name: 'Belum ada trip.' })).toBeVisible();

  const sheet = await openAddTrip(page);
  await sheet.getByRole('textbox', { name: 'Nama trip' }).fill(TRIP);
  await sheet.getByLabel('Mulai').fill(STARTS);
  await sheet.getByLabel('Selesai').fill(ENDS);
  await sheet.getByRole('textbox', { name: /Anggaran trip/ }).fill('500000');
  await sheet.getByRole('button', { name: 'Simpan trip' }).click();

  await expect(toasts(page).getByText(`Trip ${TRIP} dibuat di Pribadi`)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const row = main(page).getByRole('link', { name: new RegExp(TRIP) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Belum ada pengeluaran');
  tripHref = (await row.getAttribute('href')) ?? '';
  expect(tripHref).toMatch(/^\/pribadi\/trip\/[0-9a-f-]+$/);
});

test('Catat pengeluaran (saran K9 otomatis); Detail trip menampilkan total, sisa, dan rincian', async ({
  page,
}) => {
  await page.goto('/pribadi/beranda');
  await openCatat(page);
  const sheet = catatSheet(page);
  await expect(sheet.getByRole('button', { name: `Trip ${TRIP}, ganti` })).toBeVisible();
  await expect(
    sheet.getByText('Dipilih otomatis karena tanggalnya di rentang trip.'),
  ).toBeVisible();

  await sheet.getByRole('textbox', { name: 'Nominal' }).fill('200000');
  await sheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio').first().click();
  await sheet.getByLabel('Dari dompet').selectOption({ label: WALLET });
  await sheet.getByLabel(/Keterangan/).fill('Tiket E2E');
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page)
      .getByText(/Tersimpan di Pribadi/)
      .last(),
  ).toBeVisible();
  await expect(catatSheet(page)).toHaveCount(0);

  await page.goto(tripHref);
  await expect(main(page).getByRole('heading', { level: 1, name: TRIP })).toBeVisible();
  await expect(main(page).getByTestId('trip-total')).toContainText(rp(200_000));
  await expect(main(page)).toContainText('1 pengeluaran');
  await expect(main(page)).toContainText(`Sisa ${rp(300_000)}`);
  await expect(main(page)).toContainText('40%');
  await expect(main(page).getByRole('progressbar', { name: 'Anggaran trip' })).toHaveAttribute(
    'aria-valuenow',
    '40',
  );
  await expect(main(page)).toContainText('Per kategori');
  await expect(main(page)).toContainText('Per hari (1 hari)');
  // Pribadi tidak menampilkan Dicatat oleh.
  await expect(main(page)).not.toContainText('Dicatat oleh');

  const entryLink = main(page).getByRole('link', { name: /Tiket E2E/ });
  await expect(entryLink).toBeVisible();
  entryHref = (await entryLink.getAttribute('href')) ?? '';
  expect(entryHref).toMatch(/^\/pribadi\/transaksi\/[0-9a-f-]+$/);
});

test('Talangan dan dompet Kantor menyembunyikan pemilih Trip; Masukkan kandidat + Lebih anggaran + Keluarkan/Urungkan', async ({
  page,
}) => {
  await page.goto('/pribadi/beranda');
  await openCatat(page);
  const sheet = catatSheet(page);
  // Talangan menyembunyikan pemilih Trip.
  await sheet.getByRole('switch', { name: 'Talangan kantor' }).click();
  await expect(
    sheet.getByRole('button', { name: new RegExp(`${TRIP}|Tambah ke trip`) }),
  ).toHaveCount(0);
  await sheet.getByRole('switch', { name: 'Talangan kantor' }).click();
  // Kantor menyembunyikan pemilih Trip.
  await sheet.getByLabel('Dari dompet').selectOption({ label: KANTOR });
  await expect(sheet.getByRole('button', { name: /Tambah ke trip/ })).toHaveCount(0);
  // Simpan pengeluaran Kantor: tidak boleh jadi kandidat.
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill('50000');
  await sheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio').first().click();
  await sheet.getByLabel(/Keterangan/).fill('Parkir Kantor E2E');
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page)
      .getByText(/Tersimpan di Pribadi/)
      .last(),
  ).toBeVisible();
  await expect(catatSheet(page)).toHaveCount(0);

  const sid = await spaceId('personal');
  const [pre] = await adminQuery<{ n: string; total: string }>(
    `with c as (
       select (-l.amount)::bigint as amount
         from app.entries e
         join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id and l.role = 'main'
         join app.accounts a on a.space_id = l.space_id and a.id = l.account_id
        where e.space_id = $1 and e.kind = 'expense' and not e.reimbursable and e.voided_at is null
          and e.trip_id is null and e.occurred_on between $2::date and $3::date
          and a.pocket not in ('kantor', 'patungan')
        order by e.occurred_on desc, e.id
        limit 100
     )
     select count(*)::text as n, coalesce(sum(amount), 0)::text as total from c`,
    [sid, STARTS, ENDS],
  );
  const preCount = Number(pre?.n ?? '0');
  const preSum = Number(pre?.total ?? '0');

  // Catat pengeluaran biasa tanpa trip (Lepas) → jadi kandidat Masukkan.
  await openCatat(page);
  const sheet2 = catatSheet(page);
  await sheet2.getByRole('button', { name: `Lepas dari trip ${TRIP}` }).click();
  await sheet2.getByRole('textbox', { name: 'Nominal' }).fill('400000');
  await sheet2.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio').first().click();
  await sheet2.getByLabel('Dari dompet').selectOption({ label: WALLET });
  await sheet2.getByLabel(/Keterangan/).fill('Hotel E2E');
  await sheet2.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page)
      .getByText(/Tersimpan di Pribadi/)
      .last(),
  ).toBeVisible();
  await expect(catatSheet(page)).toHaveCount(0);

  const wantCount = preCount + 1;
  const importLabel = `Masukkan ${String(wantCount)} pengeluaran`;
  await page.goto(tripHref);
  // Hotel E2E menjadi kandidat, Parkir Kantor E2E tidak.
  await expect(main(page)).toContainText('Pengeluaran tanggal trip yang belum masuk');
  const importSheet = page.getByRole('dialog', { name: new RegExp(`Masukkan ke ${TRIP}`) });
  await expect(async () => {
    if ((await importSheet.count()) === 0) {
      await main(page).getByRole('button', { name: importLabel }).click();
    }
    await expect(importSheet.getByRole('button', { name: importLabel })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  await expect(importSheet).toContainText('Hotel E2E');
  await expect(importSheet).not.toContainText('Parkir Kantor E2E');
  await importSheet.getByRole('button', { name: importLabel }).click();
  await expect(
    toasts(page).getByText(`${String(wantCount)} pengeluaran dimasukkan ke ${TRIP}`),
  ).toBeVisible();

  // Total 600.000 + preSum > anggaran 500.000 → Lebih Rp (100.000 + preSum).
  const expectedTotal = 600_000 + preSum;
  const expectedOver = expectedTotal - 500_000;
  const expectedPct = Math.floor((expectedTotal * 100) / 500_000);
  await expect(main(page).getByTestId('trip-total')).toContainText(rp(expectedTotal));
  await expect(main(page)).toContainText(`Lebih ${rp(expectedOver)}`);
  await expect(main(page)).toContainText(`${String(expectedPct)}%`);
  await expect(main(page).getByRole('progressbar', { name: 'Anggaran trip' })).toHaveAttribute(
    'aria-valuenow',
    '100',
  );

  // Keluarkan satu lalu Urungkan.
  await main(page).getByRole('button', { name: 'Keluarkan dari trip: Hotel E2E' }).click();
  await expect(toasts(page).getByText(`Hotel E2E dikeluarkan dari ${TRIP}`)).toBeVisible();
  await expect(main(page).getByTestId('trip-total')).toContainText(rp(200_000 + preSum));
  await toasts(page).getByRole('button', { name: 'Urungkan' }).last().click();
  await expect(main(page).getByTestId('trip-total')).toContainText(rp(expectedTotal));
});

test(
  'Detail transaksi menampilkan tautan Trip, Pindahkan menyebut Trip tidak ikut; Arsip + Pulihkan; I6 + CSV',
  {
    tag: ['@I6'],
  },
  async ({ page }) => {
    const beforeSql = await totalPengeluaranSql();
    await page.goto(entryHref);
    const tripLink = main(page).getByRole('link', { name: TRIP });
    await expect(tripLink).toHaveAttribute('href', tripHref);

    // Arsipkan trip → hilang dari pemilih Catat; pulihkan → kembali aktif; I6 tidak berubah.
    await tripLink.click();
    await expect(main(page).getByRole('heading', { level: 1, name: TRIP })).toBeVisible();
    const dlg = page.getByRole('alertdialog', { name: `Arsipkan ${TRIP}?` });
    await expect(async () => {
      if ((await dlg.count()) === 0) {
        await main(page).getByRole('button', { name: 'Arsipkan' }).click();
      }
      await expect(dlg).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await dlg.getByRole('button', { name: 'Arsipkan' }).click();
    await expect(toasts(page).getByText(`Trip ${TRIP} diarsipkan`)).toBeVisible();
    await expect(main(page)).toContainText('Trip ini diarsipkan.');
    await expect(main(page).getByTestId('trip-total')).toContainText(rp(600_000));

    // Di Catat: trip terarsip tidak ditawarkan.
    await page.goto('/pribadi/beranda');
    await openCatat(page);
    await expect(catatSheet(page).getByRole('button', { name: new RegExp(TRIP) })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Pulihkan dari Detail trip.
    await page.goto(tripHref);
    await expect(async () => {
      const btn = main(page).getByRole('button', { name: `Pulihkan trip ${TRIP}` });
      if ((await btn.count()) > 0) await btn.click();
      await expect(main(page)).not.toContainText('Trip ini diarsipkan.', { timeout: 2_000 });
    }).toPass();
    await expect(toasts(page).getByText(`Trip ${TRIP} aktif lagi`)).toBeVisible();

    // I6: total pengeluaran tidak berubah oleh arsip/pulih.
    expect(await totalPengeluaranSql()).toBe(beforeSql);

    // Ekspor CSV memuat kolom Trip dengan nama trip.
    const csvRes = await page.request.get('/pribadi/laporan/ekspor');
    expect(csvRes.status()).toBe(200);
    const csv = await csvRes.text();
    expect(csv.split('\r\n')[0]).toContain(',Pencatat,Trip');
    expect(csv).toContain(TRIP);
  },
);

test('320 px tanpa gulir horizontal, axe bersih, dan budget JS ≤ 162 kB', async ({
  page,
  browser,
  ownerState,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const url of ['/pribadi/trip', tripHref]) {
    await page.goto(url);
    await expect(main(page).getByRole('heading', { level: 1 })).toBeVisible();
    await noHorizontalScroll(page);
    await expectNoSeriousViolations(page);
  }
  await expectRouteBudget(browser, ownerState, '/pribadi/trip');
  await expectRouteBudget(browser, ownerState, tripHref);
  await expectRouteBudget(browser, ownerState, '/pribadi/beranda');
  await expectRouteBudget(browser, ownerState, '/pribadi/transaksi');
});
