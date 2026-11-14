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
 * S12 Task 3 + Task 8 mode nyata: kartu `Utang yang harus dibayar` di Beranda Pribadi (angka =
 * SQL, tanpa jejak di Bersama, tautan ke Rencana > Utang, axe 320, budget JS) dan `Tetap batalkan`
 * saat membatalkan cicilan membuat saldo negatif. Mengisi data tanpa membersihkan: project `data`,
 * berkas ini sesudah `utang.spec.ts` (urutan nama) dan tidak bergantung pada isinya (angka kartu
 * dibandingkan dengan SQL, bukan konstanta).
 */
test.describe.configure({ mode: 'serial' });

const main = (page: Page) => page.getByRole('main');
const WALLET = 'Dompet Kartu N';
const BUDI = 'Budi Kartu E2E';
const SARI = 'Sari Kartu E2E';
const rp = (n: number) => `Rp ${digits(n)}`;
const rpRe = (n: number) => new RegExp(`Rp\\s${digits(n).replaceAll('.', '\\.')}`);
const CARD = 'Utang yang harus dibayar';
const paths = { sari: '' };

/** Σ sisa utang aktif Pribadi per arah (SQL, bukan UI). */
async function truth(): Promise<{ borrowed: number; lent: number }> {
  const [r] = await adminQuery<{ borrowed: string; lent: string }>(
    `select coalesce(sum(greatest(b.remaining, 0)) filter (where d.direction = 'borrowed'), 0)::text as borrowed,
            coalesce(sum(greatest(b.remaining, 0)) filter (where d.direction = 'lent'), 0)::text as lent
       from app.debts d join app.debt_balances b on b.space_id = d.space_id and b.debt_id = d.id
      where d.space_id = $1 and d.voided_at is null`,
    [await spaceId('personal')],
  );
  if (!r) throw new Error('truth');
  return { borrowed: Number(r.borrowed), lent: Number(r.lent) };
}

/** Kartu di Beranda Pribadi sama dengan SQL: tampil hanya bila ada sisa, angka per arah. */
async function expectCardMatchesSql(page: Page): Promise<Locator> {
  const t = await truth();
  await page.goto('/pribadi/beranda');
  await expect(main(page).getByRole('heading', { level: 1, name: 'Beranda' })).toBeVisible();
  const card = main(page).getByRole('region', {
    name: t.borrowed > 0 ? CARD : 'Piutang yang masih ditagih',
  });
  if (t.borrowed === 0 && t.lent === 0) {
    await expect(
      main(page).getByRole('region', { name: /^(Utang yang|Piutang yang)/ }),
    ).toHaveCount(0);
    return card;
  }
  await expect(card).toBeVisible();
  if (t.borrowed > 0) await expect(card).toContainText(rpRe(t.borrowed));
  if (t.lent > 0) {
    await expect(card).toContainText('Piutang');
    await expect(card).toContainText(rpRe(t.lent));
  }
  return card;
}

async function openAdd(page: Page): Promise<Locator> {
  await page.goto('/pribadi/rencana?bagian=utang');
  const sheet = page.getByRole('dialog', { name: /^Tambah utang/ });
  await expect(async () => {
    if ((await sheet.count()) === 0) {
      await main(page).getByRole('button', { name: 'Tambah utang' }).first().click();
    }
    await expect(sheet.getByRole('radio', { name: 'Saya berutang' })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  return sheet;
}

async function addDebt(
  page: Page,
  a: { direction: 'borrowed' | 'lent'; contact: string; amount: number },
  toast: string,
): Promise<void> {
  const sheet = await openAdd(page);
  await sheet
    .getByRole('radio', { name: a.direction === 'lent' ? 'Piutang' : 'Saya berutang' })
    .click();
  const baru = sheet.getByRole('button', { name: 'Tambah kontak baru' });
  if ((await baru.count()) > 0) await baru.click();
  await sheet.getByRole('textbox', { name: 'Nama kontak' }).fill(a.contact);
  await sheet.getByRole('textbox', { name: 'Jumlah pinjaman' }).fill(String(a.amount));
  await sheet
    .getByRole('combobox', { name: /^(Uang masuk ke|Uang keluar dari)$/ })
    .selectOption({ label: WALLET });
  await sheet.getByRole('button', { name: 'Simpan utang', exact: true }).click();
  await expect(toasts(page).getByText(toast)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Buka detail utang `name` dari daftar, bayar/terima Lunas lewat sheet. */
async function settle(page: Page, name: string, amount: number, footer: RegExp, toast: string) {
  await page.goto('/pribadi/rencana?bagian=utang');
  await main(page)
    .getByRole('listitem')
    .filter({ hasText: name })
    .first()
    .getByRole('link')
    .first()
    .click();
  await expect(page).toHaveURL(/\/pribadi\/rencana\/utang\/[0-9a-f-]{36}/);
  const detailUrl = new URL(page.url()).pathname;
  const sheet = page.getByRole('dialog', { name: /^(Bayar utang ke|Terima dari) / });
  await expect(async () => {
    if ((await sheet.count()) === 0) {
      await main(page)
        .getByRole('button', { name: /^(Bayar utang|Terima pembayaran)$/ })
        .click();
    }
    await expect(
      sheet.getByRole('radio', {
        name: new RegExp(`^Lunas, ${rp(amount)}$`.replaceAll('.', '\\.')),
      }),
    ).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  await sheet.getByRole('radio', { name: /^Lunas, / }).click();
  await sheet.getByRole('button', { name: footer }).click();
  await expect(toasts(page).getByText(toast)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return detailUrl;
}

test('kartu utang di Beranda Pribadi: angka dari SQL, netral, tautan ke Rencana > Utang', async ({
  page,
}) => {
  await addWallet(page, 'pribadi', WALLET, 100_000);
  await addDebt(
    page,
    { direction: 'borrowed', contact: BUDI, amount: 400_000 },
    `Utang ke ${BUDI} dicatat di Pribadi · ${rp(400_000)} masuk ke ${WALLET}`,
  );
  await addDebt(
    page,
    { direction: 'lent', contact: SARI, amount: 300_000 },
    `Piutang pada ${SARI} dicatat di Pribadi · ${rp(300_000)} keluar dari ${WALLET}`,
  );
  const t = await truth();
  expect(t.borrowed).toBeGreaterThanOrEqual(400_000);
  expect(t.lent).toBeGreaterThanOrEqual(300_000);

  const card = await expectCardMatchesSql(page);
  await expect(card).toContainText('Sisa utang');
  await expect(card).toContainText('Tidak mengurangi angka Aman dipakai.');
  // Tanpa "Rp 0" dan tanpa warna bahaya/pemasukan pada angka.
  await expect(card.getByText(/^Rp\s0$/)).toHaveCount(0);
  expect(await card.locator('[class*="text-danger"], [class*="text-income"]').count()).toBe(0);
  // Aman dipakai tidak turun oleh utang: kartu Aman tidak menyebut utang.
  await expect(
    main(page)
      .getByRole('region', { name: /Aman dipakai/ })
      .getByText(/utang/i),
  ).toHaveCount(0);

  await card.getByRole('link', { name: 'Lihat utang' }).click();
  await expect(page).toHaveURL(/\/pribadi\/rencana\?.*bagian=utang/);
  await expect(main(page).getByRole('region', { name: 'Sisa' })).toBeVisible();
});

test('Bersama: tanpa kartu dan tanpa kata utang/piutang di respons', async ({ page }) => {
  const r = await bersamaResponses(page, () => page.goto('/bersama/beranda'));
  expect(r.unread).toEqual([]);
  expect(r.bodies.length).toBeGreaterThan(0);
  for (const body of r.bodies) {
    expect(body).not.toContain(CARD);
    expect(body).not.toContain('Piutang yang masih ditagih');
  }
  await expect(page.getByRole('region', { name: /Utang yang|Piutang yang/ })).toHaveCount(0);
});

test('lunas semua: kartu mengikuti SQL (hilang bila tidak ada sisa)', async ({ page }) => {
  paths.sari = await settle(
    page,
    SARI,
    300_000,
    /^Terima pelunasan Rp\s300\.000$/,
    `Piutang pada ${SARI} lunas · ${rp(300_000)} di ${WALLET}`,
  );
  await settle(
    page,
    BUDI,
    400_000,
    /^Lunasi Rp\s400\.000$/,
    `Utang ke ${BUDI} lunas · ${rp(400_000)} dari ${WALLET}`,
  );
  // 100.000 + 400.000 − 300.000 + 300.000 − 400.000.
  expect(await walletBalance(page, 'pribadi', WALLET)).toBe(100_000);
  await expectCardMatchesSql(page);
});

test(
  'Batalkan penerimaan yang membuat saldo negatif: peringatan, Tetap batalkan, saldo dan sisa berubah',
  { tag: ['@K5'] },
  async ({ page }) => {
    await page.goto(paths.sari);
    const item = main(page)
      .getByRole('listitem')
      .filter({ hasText: rp(300_000) });
    await item.getByRole('button', { name: /^Batalkan pembayaran / }).click();
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toContainText('Batalkan pembayaran ini?');
    await dlg.getByRole('button', { name: 'Batalkan pembayaran', exact: true }).click();

    // Ditolak: dialog tetap, pesan tanpa nominal, tombol berganti, saldo tidak berubah.
    const alert = dlg.getByRole('alert');
    await expect(alert).toContainText('Ketuk Tetap batalkan untuk melanjutkan.');
    await expect(alert).not.toContainText('Rp');
    await expect(dlg.getByRole('button', { name: 'Batalkan pembayaran', exact: true })).toHaveCount(
      0,
    );
    expect(await walletBalance(page, 'pribadi', WALLET)).toBe(100_000);

    await page.goto(paths.sari);
    await item.getByRole('button', { name: /^Batalkan pembayaran / }).click();
    await dlg.getByRole('button', { name: 'Batalkan pembayaran', exact: true }).click();
    await dlg.getByRole('button', { name: 'Tetap batalkan' }).click();
    await expect(
      toasts(page).getByText(`Pembayaran dibatalkan · Pribadi · ${rp(300_000)}`),
    ).toBeVisible();
    await expect(dlg).toHaveCount(0);
    expect(await walletBalance(page, 'pribadi', WALLET)).toBe(-200_000);
    // Sisa piutang kembali Rp 300.000 dan kartu Beranda mengikutinya.
    await page.goto(paths.sari);
    await expect(main(page)).toContainText(rpRe(300_000));
    await expectCardMatchesSql(page);
  },
);

test('axe 320 px dan budget JS: Beranda nyata dengan kartu utang', async ({
  page,
  browser,
  ownerState,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const card = await expectCardMatchesSql(page);
  await expect(card).toBeVisible();
  await noHorizontalScroll(page);
  await expectNoSeriousViolations(page);
  await expectRouteBudget(browser, ownerState, '/pribadi/beranda');
  const a = test.info().annotations.slice(-2);
  console.log(
    `BUDGET-S12-T3 /pribadi/beranda: ${a.map((x) => `${x.type} ${x.description ?? ''}`).join(', ')}`,
  );
});
