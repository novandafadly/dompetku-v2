import type { Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../e2e/axe';
import { noHorizontalScroll } from '../e2e-auth/helpers';
import { adminQuery, expect, test } from './fixtures';
import { addWallet, catatSheet, expectRouteBudget, openCatat, toasts } from './helpers';

/**
 * S13 Task 5 mode nyata: Dompet. Kartu tujuan di Detail dompet tabungan (`Buat tujuan` dengan dompet
 * terkunci, kartu progres), teks `{tujuan} · {pct}%` di daftar Dompet, dompet non-tabungan tanpa
 * jejak tujuan, arsip dompet bertujuan ditolak (kartu + dialog saat tujuan dibuat di tab lain) lalu
 * berhasil sesudah tujuan diarsipkan, kekayaan bersih dan saldo tidak berubah oleh tujuan, 320 px,
 * axe, budget JS. Nama berkas `zz-` = jalan paling akhir di project `data` (spec ini menambah dompet
 * dan tidak membersihkannya). Satu urutan serial.
 */
test.describe.configure({ mode: 'serial' });

const main = (page: Page) => page.getByRole('main');
const SUMBER = 'Kas Sumber DT';
const TAB = 'Tabungan DT E2E';
const TAB2 = 'Tabungan DT Dua';
const GOAL = 'Dana darurat DT';
const LONG_WALLET = 'Tabungan pendidikan anak pertama dan kedua di bank syariah cabang utama';
const LONG_GOAL = 'Liburan keluarga besar ke luar negeri tahun depan bersama saudara';

async function addSavings(page: Page, name: string, opening?: number) {
  await page.goto('/pribadi/dompet?tambah=1');
  const sheet = page.getByRole('dialog', { name: /Tambah dompet/ });
  await sheet.getByRole('textbox', { name: 'Nama' }).fill(name);
  await sheet.getByRole('radio', { name: 'Tabungan' }).click();
  if (opening !== undefined) {
    await sheet.getByRole('textbox', { name: 'Saldo hari ini' }).fill(String(opening));
  }
  await sheet.getByRole('button', { name: 'Simpan dompet' }).click();
  await expect(toasts(page).getByText(new RegExp(`Dompet ${name} ditambahkan`))).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function transfer(page: Page, from: string, to: string, amount: number) {
  await page.goto('/pribadi/beranda');
  await openCatat(page);
  const expense = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
  await expense.getByRole('button', { name: 'Pengeluaran · Pribadi' }).click();
  await page.getByRole('menuitemradio', { name: 'Transfer' }).click();
  const sheet = page.getByRole('dialog', { name: 'Transfer · Pribadi' });
  await sheet.getByLabel('Dari dompet').selectOption({ label: from });
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill(String(amount));
  await sheet
    .getByRole('radiogroup', { name: 'Ke dompet' })
    .getByRole('radio', { name: new RegExp(to) })
    .click();
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page)
      .getByText(/Tersimpan di Pribadi/)
      .last(),
  ).toBeVisible();
  await expect(catatSheet(page)).toHaveCount(0);
}

async function walletId(name: string): Promise<string> {
  const [r] = await adminQuery<{ id: string }>('select id from app.accounts where name = $1', [
    name,
  ]);
  if (!r) throw new Error(`dompet ${name} tidak ada`);
  return r.id;
}

async function balanceOf(name: string): Promise<number> {
  const [r] = await adminQuery<{ b: string }>(
    `select b.balance::text as b from app.accounts a
       join app.account_balances b on b.account_id = a.id where a.name = $1`,
    [name],
  );
  return Number(r?.b);
}

async function goalStatus(name: string): Promise<string | undefined> {
  const [r] = await adminQuery<{ status: string }>(
    'select status from app.goals where name = $1 order by created_at desc limit 1',
    [name],
  );
  return r?.status;
}

async function openDetail(page: Page, name: string) {
  await page.goto('/pribadi/dompet');
  await main(page)
    .getByRole('link', { name: new RegExp(name) })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** Sheet dimuat malas: ulangi klik sampai tampil (pola spec Tujuan). */
async function openCreate(page: Page) {
  const sheet = page.getByRole('dialog', { name: /^Tambah tujuan/ });
  await expect(async () => {
    if ((await sheet.count()) === 0) {
      await main(page).getByRole('button', { name: 'Buat tujuan' }).click();
    }
    await expect(sheet.getByRole('textbox', { name: /Nama tujuan/ })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  return sheet;
}

const rowOf = (page: Page, name: string) =>
  main(page).getByRole('link', { name: new RegExp(name) });

let worthBefore = '';

test('siapkan dompet; dompet non-tabungan tanpa jejak tujuan; tabungan tanpa tujuan = ajakan', async ({
  page,
}) => {
  await addWallet(page, 'pribadi', SUMBER, 10_000_000);
  await addSavings(page, TAB);
  await openDetail(page, SUMBER);
  await expect(main(page).getByText(/tujuan/i)).toHaveCount(0);
  await expect(main(page).getByRole('button', { name: 'Buat tujuan' })).toHaveCount(0);

  await openDetail(page, TAB);
  await expect(main(page).getByText(`Belum ada tujuan untuk ${TAB}.`)).toBeVisible();
  await expect(
    main(page).getByText('Pasang target, dan progresnya mengikuti saldo dompet ini.'),
  ).toBeVisible();
  // Daftar Dompet: baris tabungan tanpa tujuan tetap menampilkan tipe.
  await page.goto('/pribadi/dompet');
  await expect(rowOf(page, TAB)).toContainText('Bank');
  worthBefore = (await page.getByTestId('net-worth').textContent()) ?? '';
});

test('Buat tujuan dari Detail dompet: dompet terkunci; kartu progres muncul; saldo dan kekayaan bersih sama', async ({
  page,
}) => {
  const balance = await balanceOf(TAB);
  await openDetail(page, TAB);
  const sheet = await openCreate(page);
  await expect(sheet.getByText(`Dompet: ${TAB}`)).toBeVisible();
  await expect(sheet.getByRole('combobox')).toHaveCount(0);
  await sheet.getByRole('textbox', { name: /Nama tujuan/ }).fill(GOAL);
  await sheet.getByRole('textbox', { name: /Target/ }).fill('4000000');
  await sheet.getByRole('button', { name: 'Simpan tujuan' }).click();
  await expect(toasts(page).getByText(`Tujuan ${GOAL} dibuat di Pribadi`)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const card = main(page).getByRole('region', { name: GOAL, exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Belum ada yang terkumpul');
  await expect(card).not.toContainText(/Rp\s0(?![.\d])/);
  await expect(card.getByRole('link', { name: /Lihat dompet/ })).toHaveCount(0);
  await expect(main(page).getByText(`Belum ada tujuan untuk ${TAB}.`)).toHaveCount(0);
  await expect(main(page).getByRole('link', { name: 'Lihat semua tujuan' })).toHaveAttribute(
    'href',
    /\/pribadi\/rencana\?bagian=tujuan/,
  );
  // Urutan DOM: kartu tujuan sesudah kartu saldo dan sebelum riwayat/aksi.
  await expect(main(page).getByTestId('wallet-balance')).toBeVisible();

  expect(await balanceOf(TAB)).toBe(balance);
  await page.goto('/pribadi/dompet');
  expect(await page.getByTestId('net-worth').textContent()).toBe(worthBefore);
});

test('daftar Dompet: baris tabungan bertujuan = `{tujuan} · {pct}%`; berubah oleh transfer', async ({
  page,
}) => {
  await page.goto('/pribadi/dompet');
  await expect(rowOf(page, TAB)).toContainText(`${GOAL} · 0%`);
  await expect(rowOf(page, TAB)).not.toContainText('Bank');
  await expect(rowOf(page, SUMBER)).toContainText('Bank');

  await transfer(page, SUMBER, TAB, 1_000_000);
  await page.goto('/pribadi/dompet');
  await expect(rowOf(page, TAB)).toContainText(`${GOAL} · 25%`);
  // Detail: kartu progres sama (25%), tanpa menghitung ulang di UI.
  await openDetail(page, TAB);
  await expect(main(page).getByRole('region', { name: GOAL, exact: true })).toContainText('25%');
  await expect(main(page).getByRole('region', { name: GOAL, exact: true })).toContainText(
    /Sisa Rp\s3\.000\.000/,
  );
});

test('Ubah dan Arsipkan dari kartu Detail dompet memakai host yang sama', async ({ page }) => {
  await openDetail(page, TAB);
  const ubah = main(page).getByRole('button', { name: `Ubah tujuan ${GOAL}` });
  const editSheet = page.getByRole('dialog', { name: /^Ubah tujuan/ });
  await expect(async () => {
    if ((await editSheet.count()) === 0) await ubah.click();
    await expect(editSheet.getByRole('textbox', { name: /Target/ })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  await editSheet.getByRole('textbox', { name: /Target/ }).fill('2000000');
  await editSheet.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(toasts(page).getByText(`Tujuan ${GOAL} diperbarui di Pribadi`)).toBeVisible();
  await expect(main(page).getByRole('region', { name: GOAL, exact: true })).toContainText('50%');
});

test(
  'arsip dompet bertujuan: kartu penjelas (saldo 0) lalu berhasil sesudah tujuan diarsipkan',
  { tag: ['@T11'] },
  async ({ page }) => {
    // Kosongkan dompet: tujuan masih aktif, jadi tombol arsip tidak ada dan kartu menjelaskan.
    await transfer(page, TAB, SUMBER, 1_000_000);
    await expect.poll(() => balanceOf(TAB)).toBe(0);
    await openDetail(page, TAB);
    await expect(main(page).getByRole('button', { name: 'Arsipkan dompet' })).toHaveCount(0);
    await expect(
      main(page).getByText(
        `${TAB} masih punya tujuan aktif ${GOAL}. Selesaikan atau arsipkan tujuannya dulu, lalu arsipkan dompet ini.`,
      ),
    ).toBeVisible();
    await main(page).getByRole('link', { name: 'Lihat tujuan' }).click();
    await expect(page).toHaveURL(/\/pribadi\/rencana\?bagian=tujuan/);

    const card = main(page).getByRole('region', { name: GOAL, exact: true });
    await card.getByRole('button', { name: `Arsipkan tujuan ${GOAL}` }).click();
    const dialog = page.getByRole('alertdialog', { name: `Arsipkan ${GOAL}?` });
    await dialog.getByRole('button', { name: 'Arsipkan', exact: true }).click();
    await expect(toasts(page).getByText(`Tujuan ${GOAL} diarsipkan`)).toBeVisible();
    expect(await goalStatus(GOAL)).toBe('archived');

    await openDetail(page, TAB);
    await expect(main(page).getByText(`Belum ada tujuan untuk ${TAB}.`)).toBeVisible();
    await main(page).getByRole('button', { name: 'Arsipkan dompet' }).click();
    const archive = page.getByRole('alertdialog', { name: `Arsipkan ${TAB}?` });
    await archive.getByRole('button', { name: 'Arsipkan', exact: true }).click();
    await expect(toasts(page).getByText(new RegExp(`${TAB}.*diarsipkan`))).toBeVisible();
    await expect(page).toHaveURL(/\/pribadi\/dompet(\?|$)/);
  },
);

test('balapan: tujuan dibuat di tab lain sesudah dialog arsip dibuka = account_has_goal di dialog', async ({
  page,
  context,
}) => {
  await addSavings(page, TAB2);
  await openDetail(page, TAB2);
  await main(page).getByRole('button', { name: 'Arsipkan dompet' }).click();
  const archive = page.getByRole('alertdialog', { name: `Arsipkan ${TAB2}?` });
  await expect(archive).toBeVisible();

  const other = await context.newPage();
  await openDetail(other, TAB2);
  const sheet = await openCreate(other);
  await sheet.getByRole('textbox', { name: /Nama tujuan/ }).fill('Tujuan tab lain');
  await sheet.getByRole('textbox', { name: /Target/ }).fill('1000000');
  await sheet.getByRole('button', { name: 'Simpan tujuan' }).click();
  await expect(toasts(other).getByText(/Tujuan Tujuan tab lain dibuat/)).toBeVisible();
  await other.close();

  await archive.getByRole('button', { name: 'Arsipkan', exact: true }).click();
  await expect(
    archive.getByText(
      `${TAB2} masih punya tujuan aktif, jadi belum bisa diarsipkan. Selesaikan atau arsipkan tujuannya dulu.`,
    ),
  ).toBeVisible();
  await expect(archive.getByRole('button', { name: 'Arsipkan', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  const [r] = await adminQuery<{ archived: boolean }>(
    'select archived_at is not null as archived from app.accounts where name = $1',
    [TAB2],
  );
  expect(r?.archived).toBe(false);
});

test('320 px: nama dompet 40 dan tujuan 60 huruf di daftar dan Detail; tanpa gulir samping; axe', async ({
  page,
}) => {
  await addSavings(page, LONG_WALLET.slice(0, 40), 750_000);
  const wallet = LONG_WALLET.slice(0, 40);
  await openDetail(page, wallet);
  const sheet = await openCreate(page);
  await sheet.getByRole('textbox', { name: /Nama tujuan/ }).fill(LONG_GOAL.slice(0, 60));
  await sheet.getByRole('textbox', { name: /Target/ }).fill('12345678900');
  await sheet.getByRole('button', { name: 'Simpan tujuan' }).click();
  await expect(toasts(page).getByText(/dibuat di Pribadi/)).toBeVisible();

  for (const [w, h] of [
    [320, 640],
    [390, 844],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const theme of ['dark', 'light']) {
      for (const url of ['/pribadi/dompet', `/pribadi/dompet/${await walletId(wallet)}`]) {
        await page.goto(`${url}?theme=${theme}`);
        await expect(main(page).getByText(LONG_GOAL.slice(0, 60)).first()).toBeVisible();
        await expectNoSeriousViolations(page);
        await noHorizontalScroll(page);
      }
      // Baris daftar: teks tujuan menggantikan baris tipe, satu baris (terpotong), tidak menambah baris.
      await page.goto(`/pribadi/dompet?theme=${theme}`);
      const goalLine = main(page).getByTitle(LONG_GOAL.slice(0, 60)).first();
      const box = await goalLine.boundingBox();
      test.info().annotations.push({
        type: `teks-tujuan-${String(w)}-${theme}`,
        description: String(Math.round(box?.height ?? 0)),
      });
      expect(box?.height ?? 99).toBeLessThanOrEqual(22);
    }
  }
});

test('budget JS: Dompet dan Detail dompet ≤ 162 kB', async ({ browser, ownerState }) => {
  const urls = [
    '/pribadi/dompet',
    `/pribadi/dompet/${await walletId(SUMBER)}`,
    `/pribadi/dompet/${await walletId(TAB2)}`,
    `/pribadi/dompet/${await walletId(LONG_WALLET.slice(0, 40))}`,
  ];
  for (const url of urls) {
    const kb = await expectRouteBudget(browser, ownerState, url);
    test.info().annotations.push({
      type: `kB ${url.replace(/[0-9a-f-]{36}/, ':id')}`,
      description: kb.toFixed(1),
    });
  }
});
