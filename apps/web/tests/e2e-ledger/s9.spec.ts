import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations, WCAG_TAGS } from '../e2e/axe';
import { noHorizontalScroll } from '../e2e-auth/helpers';
import { adminQuery, expect, test } from './fixtures';
import { expectRouteBudget, spaceId, toasts } from './helpers';

/**
 * S9 Task 10 mode nyata: Rencana > Anggaran. Tab Rencana selalu ada, kosong = ajakan, atur, ubah,
 * hapus (dialog, fokus awal Kembali), `obligation_double` dengan jalan keluar, `category_not_root`
 * (kategori berubah induk di tab lain), salin anggaran periode lalu (K13) termasuk anggaran wajib
 * yang bentrok dengan tagihan, Bersama tanpa data Pribadi, axe, dan budget JS. Satu urutan serial
 * dengan data sendiri; berjalan sendiri atau sesudah spec lain.
 */
test.describe.configure({ mode: 'serial' });

const main = (page: Page) => page.getByRole('main');
const sheetOf = (page: Page) =>
  page.getByRole('dialog', { name: /^Anggaran\s*(Pribadi|Bersama)$/ });

/** Buka sheet dengan `open`; klik sebelum hidrasi tidak membuka, jadi ulangi sampai tampil. */
async function openSheet(page: Page, open: () => Locator): Promise<Locator> {
  const sheet = sheetOf(page);
  await expect(async () => {
    if ((await sheet.count()) === 0) await open().click();
    await expect(sheet.getByRole('textbox', { name: 'Anggaran periode ini' })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  return sheet;
}

const row = (page: Page, name: string) =>
  main(page).locator('[data-budget-row]').filter({ hasText: name });

async function save(page: Page, sheet: Locator, toast: string) {
  await sheet.getByRole('button', { name: 'Simpan anggaran' }).click();
  await expect(toasts(page).getByText(toast)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function categoryId(kind: 'personal' | 'shared', name: string): Promise<string> {
  const sid = await spaceId(kind);
  const [r] = await adminQuery<{ id: string }>(
    'select id::text from app.categories where space_id = $1 and name = $2',
    [sid, name],
  );
  if (!r) throw new Error(`kategori ${name} tidak ada`);
  return r.id;
}

const MAKAN = 'Makan Siang & Minum';

test('tab Rencana ada walau ruang kosong; kosong = satu ajakan tanpa Rp 0', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/pribadi/beranda');
  const tab = page.getByRole('navigation').getByRole('link', { name: 'Rencana' });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(page).toHaveURL(/\/pribadi\/rencana$/);
  await expect(
    main(page).getByRole('heading', { name: 'Belum ada rencana di Pribadi.' }),
  ).toBeVisible();
  await expect(main(page).getByText('Rp 0')).toHaveCount(0);
  await expect(main(page).getByRole('button', { name: 'Atur anggaran pertama' })).toBeVisible();
  await expect(
    main(page).getByRole('navigation', { name: 'Bagian Rencana' }).getByRole('link', {
      name: 'Anggaran',
    }),
  ).toHaveAttribute('aria-current', 'page');
});

test('atur anggaran: validasi, simpan, baris muncul di Dianggarkan', async ({ page }) => {
  await page.goto('/pribadi/rencana');
  const sheet = await openSheet(page, () =>
    main(page).getByRole('button', { name: 'Atur anggaran pertama' }),
  );
  await expect(sheet.getByRole('combobox', { name: 'Kategori' })).toBeFocused();
  // Kategori induk pengeluaran saja (pemasukan Gaji tidak ada).
  await expect(sheet.getByRole('option', { name: 'Gaji' })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Simpan anggaran' }).click();
  await expect(sheet.getByText('Pilih kategori pengeluaran.')).toBeVisible();
  await sheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: MAKAN });
  await sheet.getByRole('button', { name: 'Simpan anggaran' }).click();
  await expect(sheet.getByText('Nominal harus lebih dari nol.')).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Anggaran periode ini' })).toBeFocused();
  await sheet.getByRole('textbox', { name: 'Anggaran periode ini' }).fill('1000000');
  await save(page, sheet, `Anggaran ${MAKAN} disimpan · Pribadi`);
  const dianggarkan = main(page).getByRole('region', { name: 'Dianggarkan', exact: true });
  await expect(dianggarkan).toContainText(MAKAN);
  await expect(dianggarkan).toContainText('0% terpakai');
  await expect(main(page).getByRole('region', { name: /Terpakai/ })).toContainText(
    'dari Rp 1.000.000',
  );
  // Kategori yang sudah dianggarkan pindah dari Belum dianggarkan.
  await expect(main(page).getByRole('region', { name: 'Belum dianggarkan' })).not.toContainText(
    MAKAN,
  );
});

test('ubah: kategori terkunci, nominal dan Wajib tersimpan; tag Wajib tampil', async ({ page }) => {
  await page.goto('/pribadi/rencana');
  const sheet = await openSheet(page, () => row(page, MAKAN));
  await expect(sheet.getByRole('combobox', { name: 'Kategori' })).toHaveCount(0);
  await expect(sheet.getByRole('textbox', { name: 'Anggaran periode ini' })).toHaveValue(
    '1.000.000',
  );
  await expect(sheet.getByRole('textbox', { name: 'Anggaran periode ini' })).toBeFocused();
  await sheet.getByRole('textbox', { name: 'Anggaran periode ini' }).fill('1500000');
  await sheet.getByRole('switch', { name: 'Wajib' }).click();
  await expect(sheet.getByRole('switch', { name: 'Wajib' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await save(page, sheet, `Anggaran ${MAKAN} disimpan · Pribadi`);
  await expect(row(page, MAKAN)).toContainText('Wajib');
  await expect(row(page, MAKAN)).toContainText('Rp 1.500.000');
  // Tersimpan di DB (upsert, satu baris).
  const rows = await adminQuery<{ amount: string; wajib: boolean }>(
    `select amount::text, wajib from app.budgets b
      where category_id = $1`,
    [await categoryId('personal', MAKAN)],
  );
  expect(rows).toEqual([{ amount: '1500000', wajib: true }]);
});

test('category_not_root: kategori berubah jadi subkategori di tab lain', async ({ page }) => {
  await page.goto('/pribadi/rencana');
  const hiburan = await categoryId('personal', 'Hiburan');
  const belanja = await categoryId('personal', 'Belanja');
  const sheet = await openSheet(page, () =>
    main(page)
      .getByRole('region', { name: 'Belum dianggarkan' })
      .locator('[data-budget-row]')
      .filter({
        hasText: 'Hiburan',
      }),
  );
  await expect(sheet.getByRole('combobox', { name: 'Kategori' })).toHaveValue(hiburan);
  await adminQuery('update app.categories set parent_id = $1 where id = $2', [belanja, hiburan]);
  try {
    await sheet.getByRole('textbox', { name: 'Anggaran periode ini' }).fill('50000');
    await sheet.getByRole('button', { name: 'Simpan anggaran' }).click();
    await expect(
      sheet.getByText('Kategori ini sudah bukan kategori induk. Tutup lalu buka Rencana lagi.'),
    ).toBeVisible();
    await expect(sheet.getByRole('combobox', { name: 'Kategori' })).toBeFocused();
  } finally {
    await adminQuery('update app.categories set parent_id = null where id = $1', [hiburan]);
  }
  expect(
    await adminQuery('select 1 from app.budgets where category_id = $1', [hiburan]),
  ).toHaveLength(0);
});

test('hapus: dialog dengan fokus awal Kembali; Kembali tidak menghapus; konfirmasi menghapus', async ({
  page,
}) => {
  await page.goto('/pribadi/rencana');
  const sheet = await openSheet(page, () => row(page, MAKAN));
  await sheet.getByRole('button', { name: 'Hapus anggaran' }).click();
  const dialog = page.getByRole('alertdialog', { name: `Hapus anggaran ${MAKAN}?` });
  await expect(dialog).toContainText('Pengeluaran kategori ini tetap tercatat.');
  await expect(dialog.getByRole('button', { name: 'Kembali' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Kembali' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Hapus anggaran' }).click();
  await dialog.getByRole('button', { name: 'Hapus anggaran' }).click();
  await expect(toasts(page).getByText(`Anggaran ${MAKAN} dihapus · Pribadi`)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Pengeluaran tidak disentuh; anggaran habis = kembali ke ajakan.
  await expect(
    main(page).getByRole('heading', { name: 'Belum ada rencana di Pribadi.' }),
  ).toBeVisible();
  expect(
    await adminQuery('select 1 from app.budgets where category_id = $1', [
      await categoryId('personal', MAKAN),
    ]),
  ).toHaveLength(0);
});

test('Bersama: obligation_double dengan nama tagihan, jalan keluar tidak wajib; tanpa data Pribadi', async ({
  page,
}) => {
  const sid = await spaceId('shared');
  const listrik = await categoryId('shared', 'Listrik & Air');
  await adminQuery(
    `insert into app.bills (space_id, name, amount, category_id, day_of_month, starts_on, created_by)
     select $1, 'Listrik PLN', 485000, $2, 5, app.today() - 40, u.id
       from auth."user" u limit 1`,
    [sid, listrik],
  );
  await page.goto('/bersama/rencana');
  await expect(main(page)).not.toContainText(MAKAN);
  await expect(main(page)).not.toContainText('Hiburan');
  // Ada tagihan, belum ada anggaran: ajakan kecil bagian Anggaran.
  await expect(main(page).getByRole('heading', { name: 'Belum ada anggaran.' })).toBeVisible();
  const sheet = await openSheet(page, () =>
    main(page).getByRole('button', { name: 'Atur anggaran pertama' }),
  );
  await sheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: 'Listrik & Air' });
  await sheet.getByRole('textbox', { name: 'Anggaran periode ini' }).fill('500000');
  await sheet.getByRole('switch', { name: 'Wajib' }).click();
  await sheet.getByRole('button', { name: 'Simpan anggaran' }).click();
  const msg =
    'Kategori ini sudah punya tagihan Listrik PLN. Satu kewajiban cukup dicatat sekali: arsipkan tagihannya atau jadikan anggaran ini tidak wajib.';
  await expect(sheet.getByText(msg)).toBeVisible();
  await expect(sheet.getByRole('switch', { name: 'Wajib' })).toBeFocused();
  await expect(sheet.getByRole('switch', { name: 'Wajib' })).toHaveAccessibleDescription(msg);
  expect(await adminQuery('select 1 from app.budgets where space_id = $1', [sid])).toHaveLength(0);
  // Jalan keluar: tidak wajib menyimpan; lalu dihapus lagi untuk tes salin.
  await sheet.getByRole('switch', { name: 'Wajib' }).click();
  await save(page, sheet, 'Anggaran Listrik & Air disimpan · Bersama');
  const edit = await openSheet(page, () => row(page, 'Listrik & Air'));
  await edit.getByRole('button', { name: 'Hapus anggaran' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Hapus anggaran', exact: true })
    .click();
  await expect(toasts(page).getByText('Anggaran Listrik & Air dihapus · Bersama')).toBeVisible();
});

test('salin anggaran periode lalu: kartu catatan, bentrok tagihan dilewati dan dijelaskan', async ({
  page,
}) => {
  const sid = await spaceId('shared');
  const prevSql = `(select (p.label_month - interval '1 month')::date from app.pay_period($1, app.today()) p)`;
  for (const [name, wajib] of [
    ['Sewa Rumah', true],
    ['Listrik & Air', true],
    ['Internet', false],
  ] as const) {
    await adminQuery(
      `insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by)
       select $1, c.id, ${prevSql}, 300000, $3, u.id
         from app.categories c, auth."user" u
        where c.space_id = $1 and c.name = $2 limit 1`,
      [sid, name, wajib],
    );
  }
  await page.goto('/bersama/rencana');
  const note = main(page).getByRole('region', { name: 'Anggaran periode lalu' });
  await expect(note).toContainText(
    'Periode ini belum punya anggaran. Periode lalu ada 3 anggaran.',
  );
  await expect(note).toContainText(
    'Anggaran wajib periode lalu belum ikut menghitung aman dipakai sampai diatur lagi.',
  );
  await expect(main(page).getByRole('button', { name: 'Atur anggaran pertama' })).toHaveCount(0);
  const copy = note.getByRole('button', { name: 'Salin anggaran periode lalu' });
  await expect(async () => {
    await copy.click();
    await expect(toasts(page).getByText(/anggaran disalin ke Bersama/)).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  await expect(toasts(page).getByText('2 anggaran disalin ke Bersama · 1 dilewati')).toBeVisible();
  const dianggarkan = main(page).getByRole('region', { name: 'Dianggarkan', exact: true });
  await expect(dianggarkan).toContainText('Sewa Rumah');
  await expect(dianggarkan).toContainText('Internet');
  await expect(dianggarkan).not.toContainText('Listrik & Air');
  await expect(
    main(page).getByText('1 anggaran wajib tidak disalin karena kategorinya sudah punya tagihan.'),
  ).toBeVisible();
  // Kartu catatan hilang (periode ini tidak kosong lagi), tombol Salin tidak ada.
  await expect(main(page).getByRole('button', { name: 'Salin anggaran periode lalu' })).toHaveCount(
    0,
  );
  // Menyalin tidak menimpa dan satu per kategori (idempoten di DB).
  const n = await adminQuery<{ n: string }>(
    'select count(*)::text as n from app.budgets where space_id = $1',
    [sid],
  );
  expect(n[0]?.n).toBe('5');
});

test('axe, 320 tanpa gulir horizontal, dua tema; kosong, terisi, sheet', async ({ page }) => {
  const sid = await spaceId('shared');
  // Nominal terbesar yang didukung di baris dan kartu total.
  await adminQuery(
    `update app.budgets set amount = 12345678900
      where space_id = $1 and category_id = (select id from app.categories where space_id = $1 and name = 'Sewa Rumah')`,
    [sid],
  );
  for (const theme of ['dark', 'light']) {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/bersama/rencana?theme=${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(
        main(page).getByRole('region', { name: 'Dianggarkan', exact: true }),
      ).toBeVisible();
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      if (width === 320) await noHorizontalScroll(page);
      const sheet = await openSheet(page, () => row(page, 'Sewa Rumah'));
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      if (width === 320) await noHorizontalScroll(page);
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
      await page.goto(`/pribadi/rencana?theme=${theme}`);
      await expect(
        main(page).getByRole('heading', { name: 'Belum ada rencana di Pribadi.' }),
      ).toBeVisible();
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      if (width === 320) await noHorizontalScroll(page);
    }
  }
});

for (const url of [
  '/pribadi/beranda',
  '/pribadi/transaksi',
  '/pribadi/rencana',
  '/bersama/rencana',
]) {
  test(`JS muat dingin ${url} mode nyata ≤ 162 kB`, async ({ browser, ownerState }) => {
    await expectRouteBudget(browser, ownerState, url);
  });
}
