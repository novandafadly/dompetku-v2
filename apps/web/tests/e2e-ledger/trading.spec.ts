import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../e2e/axe';
import { noHorizontalScroll } from '../e2e-auth/helpers';
import { adminQuery, expect, test } from './fixtures';
import {
  addWallet,
  bersamaResponses,
  digits,
  expectRouteBudget,
  openCatat,
  spaceId,
  toasts,
} from './helpers';

/**
 * S12 Task 5 mode nyata: modal trading di Dompet Pribadi. Tambah dompet Trading (hanya Pribadi),
 * kelompok Trading + kartu Modal, Setor/Tarik modal lewat sheet transfer yang sama (bukan
 * pemasukan/pengeluaran), `Kurang Rp …` dari SQL, Trading tidak ada di pemilih Catat, Bersama tanpa
 * jejak trading, axe, dan budget JS. Spec ini MENGISI data dan tidak membersihkannya: project
 * `data` (`playwright.ledger.config.ts`). Satu urutan serial dengan data sendiri.
 */
test.describe.configure({ mode: 'serial' });

const main = (page: Page) => page.getByRole('main');
const BIASA = 'Dompet Modal N';
const TRADING = 'Stockbit E2E';
const rpRe = (n: number) => new RegExp(`Rp\\s${digits(n).replaceAll('.', '\\.')}`);
const detailPath = { value: '' };

const dialogOf = (page: Page, re: RegExp) => page.getByRole('dialog', { name: re });

async function openUntil(open: () => Locator, sheet: Locator, field: Locator) {
  await expect(async () => {
    if ((await sheet.count()) === 0) await open().click();
    await expect(field).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

async function balances() {
  const rows = await adminQuery<{ name: string; balance: string }>(
    `select a.name, b.balance::text from app.accounts a
       join app.account_balances b on b.account_id = a.id
      where a.name in ($1, $2)`,
    [BIASA, TRADING],
  );
  return Object.fromEntries(rows.map((r) => [r.name, Number(r.balance)])) as Record<string, number>;
}

/** Σ income dan expense hidup di Pribadi (kebenaran SQL; modal tidak boleh menggesernya). */
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

test('tambah dompet Trading di Pribadi; Bersama tidak menawarkannya', async ({ page }) => {
  await addWallet(page, 'pribadi', BIASA, 3_000_000);
  await page.goto('/pribadi/dompet?tambah=1');
  const sheet = dialogOf(page, /Tambah dompet/);
  await sheet.getByRole('textbox', { name: 'Nama' }).fill(TRADING);
  await sheet.getByRole('radio', { name: 'Trading' }).click();
  await expect(
    sheet.getByText(
      'Untuk rekening saham, kripto, atau sejenisnya. Saldonya tidak dihitung di Aman dipakai.',
    ),
  ).toBeVisible();
  await sheet.getByRole('button', { name: 'Simpan dompet' }).click();
  await expect(toasts(page).getByText(`Dompet ${TRADING} ditambahkan di Pribadi`)).toBeVisible();
  const rows = await adminQuery<{ pocket: string }>(
    'select pocket::text from app.accounts where name = $1',
    [TRADING],
  );
  expect(rows).toEqual([{ pocket: 'trading' }]);

  await page.goto('/bersama/dompet?tambah=1');
  const bersama = dialogOf(page, /Tambah dompet/);
  await expect(bersama.getByRole('radio', { name: 'Operasional' })).toBeVisible();
  await expect(bersama.getByRole('radio', { name: 'Trading' })).toHaveCount(0);
});

test('Dompet: kelompok Trading, kartu Modal kosong, kekayaan bersih ikut trading', async ({
  page,
}) => {
  await page.goto('/pribadi/dompet');
  const group = main(page).getByRole('region', { name: 'Trading' });
  await expect(group.getByRole('link', { name: new RegExp(`^${TRADING}`) })).toBeVisible();
  const card = main(page).getByRole('region', { name: 'Modal trading' });
  await expect(card).toContainText('Belum ada modal yang disetor.');
  await expect(card).not.toContainText('Rp');
  await expect(
    main(page).getByText('Operasional, tabungan, dan trading. Kas Kantor tidak dihitung.'),
  ).toBeVisible();
  await group.getByRole('link', { name: new RegExp(`^${TRADING}`) }).click();
  await expect(page).toHaveURL(/\/pribadi\/dompet\/[0-9a-f-]{36}$/);
  detailPath.value = new URL(page.url()).pathname;
});

test('Setor modal: transfer biasa, saldo berubah sekali, pemasukan/pengeluaran tidak berubah', async ({
  page,
}) => {
  const before = await incomeExpense();
  await page.goto(detailPath.value);
  const open = main(page).getByRole('button', { name: 'Setor modal' });
  const sheet = dialogOf(page, /^Setor modal/);
  await openUntil(() => open, sheet, sheet.getByRole('textbox', { name: 'Nominal' }));
  await expect(sheet).toContainText(
    'Setor modal bukan pengeluaran. Laporan dan anggaran tidak berubah.',
  );
  // Pemilih sumber hanya dompet biasa (bukan trading, bukan kantor).
  const from = sheet.getByRole('combobox', { name: 'Dari dompet' });
  await expect(from.locator('option')).toHaveText([BIASA]);
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill('1000000');
  await sheet.getByRole('button', { name: /^Simpan/ }).click();
  await expect(
    toasts(page).getByText(
      new RegExp(`Modal disetor ke ${TRADING} · Pribadi · Rp\\s1\\.000\\.000 dari ${BIASA}`),
    ),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const b = await balances();
  expect(b[TRADING]).toBe(1_000_000);
  expect(b[BIASA]).toBe(2_000_000);
  expect(await incomeExpense()).toEqual(before);

  const card = main(page).getByRole('region', { name: 'Modal', exact: true });
  await expect(card).toContainText('Sisa modal');
  await expect(card).toContainText(rpRe(1_000_000));
  await expect(card).not.toContainText('Hasil ditarik');
  await expect(main(page).getByText(`Setor modal dari ${BIASA}`)).toBeVisible();
});

test('Cocokkan saldo turun: peringatan Kurang dari SQL; Tarik modal ke dompet biasa', async ({
  page,
}) => {
  await page.goto(detailPath.value);
  const open = main(page).getByRole('button', { name: 'Cocokkan saldo' });
  const rec = dialogOf(page, new RegExp(`Cocokkan saldo · ${TRADING}`));
  await openUntil(() => open, rec, rec.getByRole('textbox', { name: 'Saldo sebenarnya' }));
  await rec.getByRole('textbox', { name: 'Saldo sebenarnya' }).fill('700000');
  await rec.getByRole('button', { name: 'Cocokkan saldo' }).click();
  await expect(toasts(page).getByText(/selisih/)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const card = main(page).getByRole('region', { name: 'Modal', exact: true });
  const warn = card.getByRole('status');
  await expect(warn).toContainText(rpRe(300_000));
  await expect(warn).toContainText('Kurang');
  await expect(warn).toContainText('Saldo trading lebih kecil dari sisa modal yang kamu setor.');
  // Di Dompet juga (kartu Modal trading).
  await page.goto('/pribadi/dompet');
  await expect(
    main(page).getByRole('region', { name: 'Modal trading' }).getByRole('status'),
  ).toContainText(rpRe(300_000));

  // Tarik semua saldo (700.000 < sisa modal 1.000.000): sisa modal 300.000, Kurang tetap 300.000.
  await page.goto(detailPath.value);
  const tarik = main(page).getByRole('button', { name: 'Tarik modal' });
  const sheet = dialogOf(page, /^Tarik modal/);
  await openUntil(() => tarik, sheet, sheet.getByRole('textbox', { name: 'Nominal' }));
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill('700000');
  await expect(sheet).not.toContainText('di atas sisa modal');
  await sheet.getByRole('button', { name: /^Simpan/ }).click();
  await expect(
    toasts(page).getByText(
      new RegExp(`Modal ditarik dari ${TRADING} · Pribadi · Rp\\s700\\.000 ke ${BIASA}`),
    ),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const b = await balances();
  expect(b[TRADING]).toBe(0);
  expect(b[BIASA]).toBe(2_700_000);
  await expect(main(page).getByText(`Tarik modal ke ${BIASA}`)).toBeVisible();
});

test('Trading tidak ada di pemilih dompet Catat pengeluaran; Bersama tanpa jejak trading', async ({
  page,
}) => {
  await page.goto('/pribadi/beranda');
  const sheet = await openCatat(page);
  const dari = sheet.getByRole('combobox', { name: 'Dari dompet' });
  await expect(dari.locator('option', { hasText: BIASA })).toHaveCount(1);
  await expect(dari.locator('option', { hasText: TRADING })).toHaveCount(0);
  await page.keyboard.press('Escape');

  for (const path of ['/bersama/dompet', '/bersama/beranda']) {
    const { bodies, unread } = await bersamaResponses(page, () => page.goto(path));
    expect(unread).toEqual([]);
    for (const body of bodies) {
      expect(body).not.toContain(TRADING);
      expect(body).not.toContain('Modal trading');
    }
  }
});

test('axe 0 serious/critical, tanpa gulir horizontal di 320, budget JS Dompet', async ({
  page,
  browser,
  ownerState,
}) => {
  test.setTimeout(240_000);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const url of ['/pribadi/dompet', detailPath.value]) {
      await page.goto(url);
      await expect(
        main(page)
          .getByRole('region', { name: /^Modal/ })
          .first(),
      ).toBeVisible();
      if (width === 320) await noHorizontalScroll(page);
      await expectNoSeriousViolations(page);
    }
  }
  for (const url of ['/pribadi/dompet', detailPath.value]) {
    await expectRouteBudget(browser, ownerState, url);
  }
});
