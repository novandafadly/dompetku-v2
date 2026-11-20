import { randomUUID } from 'node:crypto';
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
 * S14 Task 12 mode nyata: aset non-saham di Dompet Pribadi (T11 bagian aset, S5, I6). Tambah aset emas
 * dengan nilai awal, Isi dari dompet, ubah setoran (transfer tidak bisa diubah: batalkan lalu catat
 * ulang, S5), kekayaan bersih bergeser benar, Perbarui nilai naik/turun + Urungkan, Laporan dan Aman
 * dipakai tidak berubah oleh perubahan nilai, Cairkan melebihi nilai ditolak (aset tidak minus), 320 px
 * + axe di sheet dan layar aset, budget JS. MENGISI data dan tidak membersihkannya: project `data`
 * (`playwright.ledger.config.ts`). Berkas `zz-` jalan paling akhir supaya saldo dan kekayaan bersih
 * yang dikuasainya tidak mengganggu spec lain (pola `zz-dompet-tujuan`). Satu urutan serial.
 */
test.describe.configure({ mode: 'serial' });

const main = (page: Page) => page.getByRole('main');
const SUMBER = 'Dompet Sumber Aset';
const EMAS = 'Emas Antam E2E';
const OPENING = 5_000_000;
const rp = (n: number) => `Rp ${digits(n)}`;
const state = { path: '' };

const money = rupiahOf;
const txt = async (l: Locator) => ((await l.textContent()) ?? '').replaceAll(' ', ' ');

const hero = (page: Page) => readHero(page, 'pribadi');

/** Kebenaran SQL (superuser): kekayaan bersih Pribadi hari ini dari satu fungsi yang sama dengan hero. */
async function sqlNetWorth(): Promise<number> {
  const [r] = await adminQuery<{ total: string }>(
    'select total::text from app.net_worth_at($1, app.today())',
    [await spaceId('personal')],
  );
  if (!r) throw new Error('net_worth_at');
  return Number(r.total);
}

async function balanceOf(name: string): Promise<number> {
  const [r] = await adminQuery<{ b: string }>(
    `select b.balance::text as b from app.accounts a
       join app.account_balances b on b.account_id = a.id where a.name = $1`,
    [name],
  );
  return Number(r?.b);
}

/** Σ income dan expense hidup di Pribadi (kebenaran SQL; aset tidak boleh menggesernya). */
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

/** Teks Ringkasan Laporan dan kartu Aman dipakai: tidak boleh berubah oleh perubahan nilai. */
async function reportAndSafe(page: Page): Promise<{ laporan: string; aman: string }> {
  await page.goto('/pribadi/laporan');
  const laporan = await txt(page.getByTestId('laporan-ringkasan'));
  await page.goto('/pribadi/beranda');
  const aman = await txt(page.getByTestId('balance-card'));
  return { laporan, aman };
}

/** Jumlah entri perubahan nilai hidup di aset emas ini. */
async function valuationCount(): Promise<number> {
  const [r] = await adminQuery<{ n: string }>(
    `select count(*)::text as n from app.entries e join app.entry_lines l on l.entry_id = e.id
      where e.kind = 'valuation' and e.voided_at is null
        and l.account_id = (select id from app.accounts where name = $1)`,
    [EMAS],
  );
  return Number(r?.n);
}

async function openUntil(open: () => Locator, sheet: Locator, field: Locator) {
  await expect(async () => {
    if ((await sheet.count()) === 0) await open().click();
    await expect(field).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

const detailBtn = (page: Page, name: string) => main(page).getByRole('button', { name });
const isiSheet = (page: Page) => page.getByRole('dialog', { name: new RegExp(`^Isi ${EMAS}`) });
const cairSheet = (page: Page) =>
  page.getByRole('dialog', { name: new RegExp(`^Cairkan ${EMAS}`) });
const revalueSheet = (page: Page) =>
  page.getByRole('dialog', { name: new RegExp(`^Perbarui nilai ${EMAS}`) });

async function isi(page: Page, amount: number) {
  await page.goto(state.path);
  const sheet = isiSheet(page);
  await openUntil(
    () => detailBtn(page, 'Isi dari dompet'),
    sheet,
    sheet.getByRole('textbox', { name: 'Nominal' }),
  );
  await expect(sheet).toContainText('Bukan pengeluaran. Laporan dan anggaran tidak berubah.');
  await sheet.getByRole('combobox', { name: 'Dari dompet' }).selectOption({ label: SUMBER });
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill(String(amount));
  await sheet.getByRole('button', { name: /^Simpan/ }).click();
  await expect(
    toasts(page).getByText(
      new RegExp(
        `${EMAS} diisi · Pribadi · Rp\\s${digits(amount).replaceAll('.', '\\.')} dari ${SUMBER}`,
      ),
    ),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function revalue(page: Page, value: number, hint: string) {
  await page.goto(state.path);
  const sheet = revalueSheet(page);
  const field = sheet.getByRole('textbox', { name: 'Nilai sekarang' });
  await openUntil(() => detailBtn(page, 'Perbarui nilai'), sheet, field);
  await field.fill(String(value));
  await expect(sheet.getByText(hint)).toBeVisible();
  await sheet.getByRole('button', { name: 'Simpan nilai' }).click();
  await expect(toasts(page).getByText(`Nilai ${EMAS} diperbarui`)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('tambah aset emas dengan nilai awal: kelompok Aset, kekayaan bersih naik sebesar nilainya', async ({
  page,
}) => {
  await addWallet(page, 'pribadi', SUMBER, 2_000_000);
  const base = await hero(page);

  await page.goto('/pribadi/dompet');
  const sheet = page.getByRole('dialog', { name: /^Tambah aset/ });
  await openUntil(
    () =>
      main(page)
        .getByRole('button', { name: /Tambah aset/ })
        .first(),
    sheet,
    sheet.getByLabel('Jenis aset'),
  );
  await sheet.getByLabel('Jenis aset').selectOption('emas');
  await sheet.getByRole('textbox', { name: 'Nama' }).fill(EMAS);
  await sheet.getByRole('textbox', { name: 'Nilai sekarang' }).fill(String(OPENING));
  await sheet.getByRole('button', { name: 'Simpan aset' }).click();
  await expect(toasts(page).getByText(`Aset ${EMAS} ditambahkan di Pribadi`)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const row = await adminQuery<{ pocket: string; asset_kind: string }>(
    `select a.pocket::text, d.asset_kind from app.accounts a
       join app.asset_details d on d.account_id = a.id where a.name = $1`,
    [EMAS],
  );
  expect(row).toEqual([{ pocket: 'aset', asset_kind: 'emas' }]);

  const after = await hero(page);
  expect(after.total).toBe(base.total + OPENING);
  expect(after.total).toBe(await sqlNetWorth());
  expect(after.parts.Aset).toBe((base.parts.Aset ?? 0) + OPENING);
  const group = main(page).getByRole('region', { name: 'Aset' });
  const link = group.getByRole('link', { name: new RegExp(`^${EMAS}`) });
  await expect(link).toContainText('Emas');
  await expect(link).toContainText(rp(OPENING));
  await link.click();
  await expect(page).toHaveURL(/\/pribadi\/dompet\/[0-9a-f-]{36}$/);
  state.path = new URL(page.url()).pathname;
  await expect(page.getByTestId('wallet-balance')).toContainText(rp(OPENING));
  await expect(main(page).getByText(`Nilai ${EMAS}`)).toBeVisible();
  // Aset tidak ada di pemilih Catat pengeluaran: hanya dompet biasa.
});

test(
  'S5: Isi 500.000, batalkan, catat ulang 600.000: aset naik 600.000, dompet −600.000, kekayaan bersih tetap',
  { tag: ['@S5', '@T11'] },
  async ({ page }) => {
    const nw0 = await sqlNetWorth();
    const sumber0 = await balanceOf(SUMBER);
    const before = await incomeExpense();

    await isi(page, 500_000);
    expect(await balanceOf(EMAS)).toBe(OPENING + 500_000);
    expect(await balanceOf(SUMBER)).toBe(sumber0 - 500_000);
    expect(await sqlNetWorth()).toBe(nw0);

    // Transfer tidak bisa diubah: Ubah = batalkan lalu catat ulang.
    await page.goto(state.path);
    const link = main(page).getByRole('link', { name: new RegExp(`Isi dari ${SUMBER}`) });
    await expect(link).toHaveCount(1);
    await link.click();
    await expect(main(page).getByRole('button', { name: 'Ubah' })).toHaveCount(0);
    await main(page).getByRole('button', { name: 'Batalkan transaksi' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Batalkan transaksi' }).click();
    await expect(page).toHaveURL(/\/pribadi\/transaksi$/);
    expect(await balanceOf(EMAS)).toBe(OPENING);
    expect(await balanceOf(SUMBER)).toBe(sumber0);

    await isi(page, 600_000);
    expect(await balanceOf(EMAS)).toBe(OPENING + 600_000);
    expect(await balanceOf(SUMBER)).toBe(sumber0 - 600_000);
    expect(await sqlNetWorth()).toBe(nw0);
    expect(await incomeExpense()).toEqual(before);

    const h = await hero(page);
    expect(h.total).toBe(nw0);
    await page.goto(state.path);
    await expect(page.getByTestId('wallet-balance')).toContainText(rp(OPENING + 600_000));
    // Pembatalan kedua tidak menggandakan apa pun: tepat satu kaki hidup yang terlihat di riwayat.
    await expect(
      main(page).getByRole('link', { name: new RegExp(`Isi dari ${SUMBER}`) }),
    ).toHaveCount(1);
  },
);

test(
  'Perbarui nilai naik lalu turun: nilai aset dan kekayaan bersih bergeser, Laporan dan Aman dipakai tidak berubah',
  { tag: ['@I6', '@T11'] },
  async ({ page }) => {
    const level = OPENING + 600_000;
    const nw0 = await sqlNetWorth();
    const still = await reportAndSafe(page);
    const sums = await incomeExpense();

    await revalue(page, level + 400_000, `Naik ${rp(400_000)}`);
    expect(await balanceOf(EMAS)).toBe(level + 400_000);
    expect(await sqlNetWorth()).toBe(nw0 + 400_000);
    await expect(page.getByTestId('wallet-balance')).toContainText(rp(level + 400_000));
    const up = main(page).getByRole('link', { name: /Perubahan nilai/ });
    await expect(up.first()).toContainText('Naik');
    await expect(up.first()).toContainText('+');

    await revalue(page, level - 250_000, `Turun ${rp(650_000)}`);
    expect(await balanceOf(EMAS)).toBe(level - 250_000);
    expect(await sqlNetWorth()).toBe(nw0 - 250_000);
    await expect(
      main(page)
        .getByRole('link', { name: /Perubahan nilai/ })
        .first(),
    ).toContainText('Turun');
    const h = await hero(page);
    expect(h.total).toBe(nw0 - 250_000);
    expect(h.parts.Aset).toBe(level - 250_000);

    // I6: bukan pemasukan/pengeluaran, Laporan dan Aman dipakai sama persis.
    expect(await incomeExpense()).toEqual(sums);
    const now = await reportAndSafe(page);
    expect(now.laporan).toBe(still.laporan);
    expect(now.aman).toBe(still.aman);
    await page.goto('/pribadi/laporan');
    await expect(page.getByTestId('laporan-tidak-termasuk')).toContainText('Perubahan nilai aset');

    // Nilai sama = tidak ada yang dicatat.
    const n0 = await valuationCount();
    await page.goto(state.path);
    const sheet = revalueSheet(page);
    const field = sheet.getByRole('textbox', { name: 'Nilai sekarang' });
    await openUntil(() => detailBtn(page, 'Perbarui nilai'), sheet, field);
    await field.fill(String(level - 250_000));
    await expect(sheet.getByText('Nilainya sama, tidak ada yang dicatat.')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await valuationCount()).toBe(n0);
  },
);

test('Urungkan perubahan nilai: nilai kembali, kekayaan bersih kembali', async ({ page }) => {
  const before = await balanceOf(EMAS);
  const nw0 = await sqlNetWorth();
  await revalue(page, before + 1_000_000, `Naik ${rp(1_000_000)}`);
  expect(await balanceOf(EMAS)).toBe(before + 1_000_000);
  await toasts(page).getByRole('button', { name: 'Urungkan' }).click();
  await expect.poll(() => balanceOf(EMAS)).toBe(before);
  expect(await sqlNetWorth()).toBe(nw0);
});

test(
  'Cairkan melebihi nilai ditolak (aset tidak minus); Cairkan sebagian dan sisanya jalan',
  { tag: ['@T11'] },
  async ({ page }) => {
    const value = await balanceOf(EMAS);
    const sumber0 = await balanceOf(SUMBER);
    const nw0 = await sqlNetWorth();

    await page.goto(state.path);
    const sheet = cairSheet(page);
    await openUntil(
      () => detailBtn(page, 'Cairkan ke dompet'),
      sheet,
      sheet.getByRole('textbox', { name: 'Nominal' }),
    );
    await expect(sheet).toContainText('Bukan pemasukan.');
    await sheet.getByRole('textbox', { name: 'Nominal' }).fill(String(value + 1));
    await sheet.getByRole('radio', { name: SUMBER, exact: true }).click();
    await expect(sheet.getByRole('alert')).toContainText(
      `Nilai ${EMAS} tidak cukup. Aset tidak bisa minus.`,
    );
    // Simpan tertutup selama nilainya kurang; dan DB sendiri menolak walau UI diakali (DK422).
    await expect(sheet.getByRole('button', { name: /^Simpan/ })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const ids = await adminQuery<{ id: string; name: string }>(
      'select id::text, name from app.accounts where name = any($1)',
      [[EMAS, SUMBER]],
    );
    const idOf = (n: string) => ids.find((x) => x.name === n)?.id;
    const { uid, sid } = await spaceOf(OWNER, 'personal');
    await expect(
      asUser(
        uid,
        'select api.create_transfer($1, $2, $3, $4, $5::bigint, 0::bigint, app.today())',
        [randomUUID(), sid, idOf(EMAS), idOf(SUMBER), value + 1],
      ),
    ).rejects.toThrow(/asset_negative/);
    expect(await balanceOf(EMAS)).toBe(value);
    expect(await balanceOf(SUMBER)).toBe(sumber0);
    const [r] = await adminQuery<{ n: string }>(
      `select count(*)::text as n from app.account_balances b join app.accounts a on a.id = b.account_id
        where a.pocket = 'aset' and b.balance < 0`,
    );
    expect(r?.n).toBe('0');

    // Cairkan sebagian: sisa nilai turun, dompet tujuan naik, kekayaan bersih tetap.
    await page.goto(state.path);
    await openUntil(
      () => detailBtn(page, 'Cairkan ke dompet'),
      sheet,
      sheet.getByRole('textbox', { name: 'Nominal' }),
    );
    await sheet.getByRole('textbox', { name: 'Nominal' }).fill('300000');
    await sheet.getByRole('radio', { name: SUMBER, exact: true }).click();
    await sheet.getByRole('button', { name: /^Simpan/ }).click();
    await expect(
      toasts(page).getByText(
        new RegExp(`${EMAS} dicairkan · Pribadi · Rp\\s300\\.000 ke ${SUMBER}`),
      ),
    ).toBeVisible();
    expect(await balanceOf(EMAS)).toBe(value - 300_000);
    expect(await balanceOf(SUMBER)).toBe(sumber0 + 300_000);
    expect(await sqlNetWorth()).toBe(nw0);
    await expect(
      main(page).getByRole('link', { name: new RegExp(`Cair ke ${SUMBER}`) }),
    ).toHaveCount(1);
  },
);

test('axe 0 serious/critical, tanpa gulir horizontal di 320: Dompet, Detail aset, sheet aset', async ({
  page,
  browser,
  ownerState,
}) => {
  test.setTimeout(240_000);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const url of ['/pribadi/dompet', state.path]) {
      await page.goto(url);
      await expect(main(page).getByRole('heading', { level: 1 })).toBeVisible();
      if (width === 320) await noHorizontalScroll(page);
      await expectNoSeriousViolations(page);
    }
  }
  // Sheet di 320: Tambah aset, Perbarui nilai, Isi, Cairkan.
  await page.setViewportSize({ width: 320, height: 640 });
  const sheets: [string, () => Locator, () => Locator, string][] = [
    [
      state.path,
      () => revalueSheet(page),
      () => revalueSheet(page).getByRole('textbox', { name: 'Nilai sekarang' }),
      'Perbarui nilai',
    ],
    [
      state.path,
      () => isiSheet(page),
      () => isiSheet(page).getByRole('textbox', { name: 'Nominal' }),
      'Isi dari dompet',
    ],
    [
      state.path,
      () => cairSheet(page),
      () => cairSheet(page).getByRole('textbox', { name: 'Nominal' }),
      'Cairkan ke dompet',
    ],
  ];
  for (const [url, sheet, field, button] of sheets) {
    await page.goto(url);
    await openUntil(() => detailBtn(page, button), sheet(), field());
    await noHorizontalScroll(page);
    await expectNoSeriousViolations(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.goto('/pribadi/dompet');
  const tambah = page.getByRole('dialog', { name: /^Tambah aset/ });
  await openUntil(
    () =>
      main(page)
        .getByRole('button', { name: /Tambah aset/ })
        .first(),
    tambah,
    tambah.getByLabel('Jenis aset'),
  );
  await noHorizontalScroll(page);
  await expectNoSeriousViolations(page);
  await page.keyboard.press('Escape');

  for (const url of ['/pribadi/dompet', state.path]) {
    await expectRouteBudget(browser, ownerState, url);
  }
});
