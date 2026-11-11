import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations, WCAG_TAGS } from '../e2e/axe';
import { noHorizontalScroll } from '../e2e-auth/helpers';
import { adminQuery, expect, test } from './fixtures';
import {
  addWallet,
  chipsOf,
  digits,
  expectRouteBudget,
  openCatat,
  spaceId,
  toasts,
} from './helpers';

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
  await expectFocusKept(page);
}

/** Fokus tidak jatuh ke <body> sesudah perubahan yang memuat ulang halaman (I2). */
async function expectFocusKept(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName ?? 'BODY'), { timeout: 5_000 })
    .not.toBe('BODY');
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
  // Simpan tidak aria-disabled: ketukan memunculkan galat kolom (role=alert) dan memindah fokus.
  await expect(
    sheet.getByRole('alert').filter({ hasText: 'Pilih kategori pengeluaran.' }),
  ).toBeVisible();
  await expect(sheet.getByRole('combobox', { name: 'Kategori' })).toBeFocused();
  await sheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: MAKAN });
  await sheet.getByRole('button', { name: 'Simpan anggaran' }).click();
  await expect(
    sheet.getByRole('alert').filter({ hasText: 'Nominal harus lebih dari nol.' }),
  ).toBeVisible();
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

test('anggaran rincian (S10): Tambah rincian, batas induk, hapus induk menghapus rincian', async ({
  page,
}) => {
  const sid = await spaceId('personal');
  const [induk] = await adminQuery<{ id: string }>(
    `insert into app.categories (space_id, type, name, icon) values ($1, 'expense', 'Rincian Uji', 'Receipt')
     returning id::text`,
    [sid],
  );
  const parent = induk?.id ?? '';
  for (const n of ['Sub A', 'Sub B'])
    await adminQuery(
      `insert into app.categories (space_id, parent_id, type, name, icon)
       values ($1, $2, 'expense', $3, 'Receipt')`,
      [sid, parent, n],
    );
  const subSheet = page.getByRole('dialog', { name: /^Anggaran rincian\s*Pribadi$/ });
  try {
    await page.goto('/pribadi/rencana');
    const sheet = await openSheet(page, () =>
      main(page)
        .getByRole('region', { name: 'Belum dianggarkan' })
        .locator('[data-budget-row]')
        .filter({ hasText: 'Rincian Uji' }),
    );
    await sheet.getByRole('textbox', { name: 'Anggaran periode ini' }).fill('500000');
    await save(page, sheet, 'Anggaran Rincian Uji disimpan · Pribadi');
    // Induk beranggaran + subkategori aktif tanpa anggaran = ada Tambah rincian.
    const add = main(page).getByRole('button', { name: 'Tambah rincian untuk Rincian Uji' });
    const openSub = async () => {
      await expect(async () => {
        if ((await subSheet.count()) === 0) await add.click();
        await expect(subSheet.getByRole('textbox', { name: 'Anggaran periode ini' })).toBeVisible({
          timeout: 2_000,
        });
      }).toPass();
    };
    await openSub();
    await expect(subSheet.getByRole('switch', { name: 'Wajib' })).toHaveCount(0);
    await subSheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: 'Sub A' });
    await expect(subSheet).toContainText('Maksimal Rp 500.000');
    await subSheet.getByRole('textbox', { name: 'Anggaran periode ini' }).fill('400000');
    await subSheet.getByRole('button', { name: 'Simpan anggaran' }).click();
    await expect(toasts(page).getByText('Anggaran Sub A disimpan · Pribadi')).toBeVisible();
    const list = main(page).getByRole('list', { name: 'Rincian Rincian Uji' });
    await expect(list).toContainText('Sub A');
    await expect(row(page, 'Rincian Uji').first()).toContainText(
      'Dibagi ke 1 rincian · Rp 400.000',
    );
    // Sub B melewati sisa induk (400.000 + 200.000 > 500.000): galat tanpa nominal, tidak tersimpan.
    await openSub();
    await subSheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: 'Sub B' });
    await expect(subSheet).toContainText('Maksimal Rp 100.000');
    await subSheet.getByRole('textbox', { name: 'Anggaran periode ini' }).fill('200000');
    await subSheet.getByRole('button', { name: 'Simpan anggaran' }).click();
    const alert = subSheet
      .getByRole('alert')
      .filter({ hasText: 'Rincian melebihi anggaran induk.' });
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(/\d/);
    await page.keyboard.press('Escape');
    // Induk tidak bisa lebih kecil dari jumlah rincian; hapus induk menghapus rinciannya.
    const parentSheet = await openSheet(page, () => row(page, 'Rincian Uji').first());
    await expect(parentSheet).toContainText('Dibagi ke rincian Rp 400.000');
    await parentSheet.getByRole('textbox', { name: 'Anggaran periode ini' }).fill('300000');
    await parentSheet.getByRole('button', { name: 'Simpan anggaran' }).click();
    await expect(
      parentSheet.getByText(
        'Anggaran induk tidak boleh lebih kecil dari jumlah anggaran rinciannya.',
      ),
    ).toBeVisible();
    await parentSheet.getByRole('button', { name: 'Hapus anggaran' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Hapus anggaran Rincian Uji?' });
    await expect(dialog).toContainText('Anggaran 1 rinciannya ikut dihapus.');
    await dialog.getByRole('button', { name: 'Hapus anggaran' }).click();
    await expect(toasts(page).getByText('Anggaran Rincian Uji dihapus · Pribadi')).toBeVisible();
    const left = await adminQuery(
      'select 1 from app.budgets where category_id in (select id from app.categories where space_id = $1 and (id = $2 or parent_id = $2))',
      [sid, parent],
    );
    expect(left).toHaveLength(0);
  } finally {
    await adminQuery(
      'delete from app.budgets where space_id = $1 and category_id in (select id from app.categories where id = $2 or parent_id = $2)',
      [sid, parent],
    );
    await adminQuery('delete from app.categories where parent_id = $1', [parent]);
    await adminQuery('delete from app.categories where id = $1', [parent]);
  }
});

test('kategori berubah jadi subkategori di tab lain (parent_budget_required)', async ({ page }) => {
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
  await expectFocusKept(page);
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

test('realisasi nyata: 85% terpakai dengan ikon, lalu Lewat Rp … di baris dan kartu total', async ({
  page,
}) => {
  await addWallet(page, 'pribadi', 'BCA', 5_000_000);
  const expense = async (amount: number) => {
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
  };
  const kategori = await expense(850_000);
  await page.goto('/pribadi/rencana');
  // Pengeluaran kategori itu sampai sekarang (spec lain bisa sudah memakainya), lalu anggaran
  // dipilih supaya terpakai ~85% (80–99%).
  const [sum] = await adminQuery<{ spent: string }>(
    `select coalesce(-sum(amount), 0)::text as spent from app.report_lines
      where space_id = $1 and root_category_id = $2 and report_class = 'expense'`,
    [await spaceId('personal'), await categoryId('personal', kategori)],
  );
  const spent0 = Number(sum?.spent ?? 0);
  expect(spent0).toBeGreaterThanOrEqual(850_000);
  const budget = Math.ceil(spent0 / 0.85 / 1000) * 1000;
  const sheet = await openSheet(page, () =>
    main(page).getByRole('button', { name: 'Atur anggaran' }).first(),
  );
  await sheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: kategori });
  await sheet.getByRole('textbox', { name: 'Anggaran periode ini' }).fill(String(budget));
  await save(page, sheet, `Anggaran ${kategori} disimpan · Pribadi`);
  // ≥ 80%: ikon peringatan (selain caret) + teks, sisa di sub dan kartu total.
  await expect(row(page, kategori)).toContainText(/[89]\d% terpakai/);
  await expect(row(page, kategori).locator('svg')).toHaveCount(2);
  await expect(main(page).getByRole('region', { name: /Terpakai/ })).toContainText(
    `sisa Rp ${digits(budget - spent0)}`,
  );
  await expense(300_000);
  await page.goto('/pribadi/rencana');
  const over = `Lewat Rp ${digits(spent0 + 300_000 - budget)}`;
  await expect(row(page, kategori)).toContainText(over);
  await expect(row(page, kategori).locator('svg')).toHaveCount(2);
  await expect(main(page).getByRole('region', { name: /Terpakai/ })).toContainText(over);
  // Pulihkan keadaan kosong untuk tes berikutnya.
  const edit = await openSheet(page, () => row(page, kategori));
  await edit.getByRole('button', { name: 'Hapus anggaran' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Hapus anggaran', exact: true })
    .click();
  await expect(toasts(page).getByText(`Anggaran ${kategori} dihapus · Pribadi`)).toBeVisible();
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
  await expect(sheet.getByRole('switch', { name: 'Wajib' })).toHaveAccessibleDescription(
    `Dipotong dari aman dipakai sampai terpakai. ${msg}`,
  );
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
  await expectFocusKept(page);
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
