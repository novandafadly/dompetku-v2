import type { Page } from '@playwright/test';
import { expectNoSeriousViolations, WCAG_TAGS } from '../e2e/axe';
import { checkScreen, noHorizontalScroll, spaceOf } from '../e2e-auth/helpers';
import { adminQuery } from '../e2e-ledger/fixtures';
import {
  bersamaResponses,
  digits,
  expectRouteBudget,
  openAndFill,
  toasts,
} from '../e2e-ledger/helpers';
import { expect, test } from './fixtures';
import { OWNER, PARTNER } from './global-setup';

/**
 * Bagi tagihan Bersama / patungan (S12 Task 7), dua user di ledger nyata: N mencatat listrik Bersama
 * dari dompet Pribadinya (sama rata) → saldo patungan di Beranda kedua anggota → F melunasi dari
 * dompet Pribadinya → N menerima ke dompetnya; batal terima, batal pelunasan, hapus dan pulihkan
 * tagihan; Pribadi pasangan tidak pernah sampai ke HTML/payload Bersama; Pribadi = 404; axe 320;
 * budget JS. Dijalankan paling akhir (nama berkas): data patungan tidak mengganggu spec lain.
 */
test.describe.configure({ mode: 'serial' });

const N_WALLET = 'KANARI-DOMPET-N';
const F_WALLET = 'KANARI-DOMPET-F';
const BILL = 'Listrik patungan uji';
const AMOUNT = 400_000;
const HALF = 200_000;

const main = (page: Page) => page.getByRole('main');
const rp = (n: number) => `Rp ${digits(n)}`;
const rpRe = (n: number) => new RegExp(`Rp\\s${digits(n).replace(/\./g, '\\.')}`);

async function walletBalance(email: string, name: string): Promise<number> {
  const { sid } = await spaceOf(email, 'personal');
  const [r] = await adminQuery<{ balance: string }>(
    `select b.balance::text from app.account_balances b
       join app.accounts a on a.id = b.account_id where a.space_id = $1 and a.name = $2`,
    [sid, name],
  );
  if (!r) throw new Error('dompet tidak ada');
  return Number(r.balance);
}

async function balances(): Promise<{ n: number; f: number }> {
  return { n: await walletBalance(OWNER, N_WALLET), f: await walletBalance(PARTNER, F_WALLET) };
}

/** Saldo patungan dari SQL (Bersama): arah dan nominal. */
async function ledgerState() {
  const { sid } = await spaceOf(OWNER, 'shared');
  const [r] = await adminQuery<{
    splits: string;
    live_settlements: string;
    received: string;
    voided_splits: string;
  }>(
    `select (select count(*) from app.splits where space_id = $1 and voided_at is null)::text as splits,
            (select count(*) from app.settlements where space_id = $1 and voided_at is null)::text
              as live_settlements,
            (select count(*) from app.settlements
              where space_id = $1 and voided_at is null and received_entry_id is not null)::text
              as received,
            (select count(*) from app.splits where space_id = $1 and voided_at is not null)::text
              as voided_splits`,
    [sid],
  );
  if (!r) throw new Error('keadaan');
  return {
    splits: Number(r.splits),
    settlements: Number(r.live_settlements),
    received: Number(r.received),
    voided: Number(r.voided_splits),
  };
}

const card = (page: Page) => main(page).getByRole('region', { name: 'Saldo patungan' });

let balanceBefore: { n: number; f: number };

test('N mencatat listrik Bersama dari dompet Pribadi (sama rata): saldo turun sekali, toast dari SQL', async ({
  page,
  kanari,
}) => {
  expect(kanari.n.wallet).toBe(N_WALLET);
  balanceBefore = await balances();
  await page.goto('/bersama/beranda');
  // Bersama belum punya patungan: kartu tidak dirender.
  await expect(main(page).getByRole('heading', { name: 'Saldo patungan' })).toHaveCount(0);
  const sheet = await openAndFill(page, { amount: AMOUNT, description: BILL });
  const toggle = sheet.getByRole('switch', { name: 'Dibayar dari dompet pribadi' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  const wallet = sheet.getByRole('combobox', { name: 'Dari dompet pribadi' });
  await expect(wallet.locator('option', { hasText: N_WALLET })).toHaveCount(1);
  await wallet.selectOption({ label: N_WALLET });
  await expect(sheet.getByText('Dibagi rata dengan Farida')).toBeVisible();
  // Dompet Pribadi F tidak pernah ada di pilihan.
  await expect(wallet.locator('option', { hasText: F_WALLET })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page).getByText(
      `Patungan dicatat di Bersama · ${rp(AMOUNT)} dari ${N_WALLET} · Farida menanggung ${rp(HALF)}`,
    ),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);
  const after = await balances();
  expect(after.n).toBe(balanceBefore.n - AMOUNT);
  expect(after.f).toBe(balanceBefore.f);
  expect(await ledgerState()).toMatchObject({ splits: 1, settlements: 0 });
});

test('Beranda Bersama: kartu Saldo patungan dari dua sudut pandang; Pribadi tanpa jejak', async ({
  page,
  partnerPage,
}) => {
  await page.goto('/bersama/beranda');
  await expect(card(page)).toContainText(`Farida berutang ${rp(HALF)} ke kamu`);
  await expect(card(page)).toContainText('Dari 1 tagihan patungan dan 0 pelunasan.');
  await expect(card(page).getByRole('link', { name: /^Lunasi/ })).toHaveCount(0);
  await partnerPage.goto('/bersama/beranda');
  await expect(card(partnerPage)).toContainText(`Kamu berutang ${rp(HALF)} ke Novanda`);
  await expect(
    card(partnerPage).getByRole('link', { name: 'Lunasi patungan ke Novanda' }),
  ).toBeVisible();
  // Transaksi Bersama: satu pengeluaran berlabel patungan, tanpa kaki dompet sistem.
  await page.goto('/bersama/transaksi');
  await expect(main(page)).toContainText(BILL);
  await expect(main(page)).toContainText('Dibayar dari dompet pribadi Novanda');
  // Kaki dompet sistem tidak tampil sebagai setoran anggota (spec lain mengisi Setoran dari … lain).
  await expect(
    main(page).getByRole('link', { name: new RegExp(`Setoran dari.*${digits(AMOUNT)}`) }),
  ).toHaveCount(0);
  await expect(main(page)).not.toContainText(N_WALLET);
  // Transaksi Pribadi N: kaki keluar berlabel, bukan pengeluaran pribadi.
  await page.goto('/pribadi/transaksi');
  await expect(main(page).getByText('Bayar untuk Bersama')).toBeVisible();
  // Pribadi tidak punya halaman Patungan.
  // Status stream bisa 200 saat page melempar notFound (Suspense); isi halaman = 404.
  await page.goto('/pribadi/patungan');
  await expect(page.getByRole('heading', { level: 1, name: '404' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Patungan · Bersama');
});

test('F melunasi dari dompet Pribadinya: Lunasi dari kartu, sheet terbuka, saldo impas, N menunggu terima', async ({
  partnerPage,
}) => {
  await partnerPage.goto('/bersama/beranda');
  await card(partnerPage).getByRole('link', { name: 'Lunasi patungan ke Novanda' }).click();
  await expect(partnerPage).toHaveURL(/\/bersama\/patungan/);
  const sheet = partnerPage.getByRole('dialog', { name: /^Lunasi patungan\W*Bersama$/ });
  const amount = sheet.getByRole('textbox', { name: 'Jumlah dilunasi' });
  await expect(amount).toHaveValue(digits(HALF));
  await expect(sheet).toContainText(`Kamu berutang ${rp(HALF)} ke Novanda`);
  const wallet = sheet.getByRole('combobox', { name: 'Dari dompet pribadi' });
  await expect(wallet.locator('option', { hasText: F_WALLET })).toHaveCount(1);
  // Bayar lebih ditolak di klien dengan salinan bingkai; tombol Lunasi semua mengisi, tidak menyimpan.
  await amount.fill(String(HALF + 1));
  await expect(sheet).toContainText('Jumlah ini lebih besar dari utangmu. Kurangi jumlahnya.');
  await sheet.getByRole('button', { name: /^Lunasi semua/ }).click();
  await expect(amount).toHaveValue(digits(HALF));
  const before = await balances();
  await sheet.getByRole('button', { name: new RegExp(`^Lunasi ${rpRe(HALF).source}$`) }).click();
  await expect(
    toasts(partnerPage).getByText(
      `Pelunasan dicatat di Bersama · ${rp(HALF)} dari ${F_WALLET} · menunggu Novanda menerima`,
    ),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);
  const after = await balances();
  expect(after.f).toBe(before.f - HALF);
  expect(await ledgerState()).toMatchObject({ settlements: 1, received: 0 });
  await partnerPage.goto('/bersama/beranda');
  await expect(card(partnerPage).getByText('Patungan impas')).toBeVisible();
  await expect(card(partnerPage)).not.toContainText('Rp');
});

test('N menerima ke dompetnya dari kartu Beranda; uang bukan pemasukan', async ({ page }) => {
  await page.goto('/bersama/beranda');
  await expect(card(page)).toContainText(`Farida sudah melunasi ${rp(HALF)}. Terima ke dompet?`);
  const before = await balances();
  await card(page).getByRole('link', { name: 'Terima' }).click();
  const sheet = page.getByRole('dialog', { name: /^Terima pelunasan\W*Bersama$/ });
  await expect(sheet).toContainText(`Farida melunasi ${rp(HALF)}`);
  await expect(sheet.getByRole('combobox', { name: 'Terima ke dompet' })).toBeVisible();
  await expect(sheet).toContainText('Ini bukan pemasukan.');
  await sheet.getByRole('button', { name: new RegExp(`^Terima ${rpRe(HALF).source}$`) }).click();
  await expect(
    toasts(page).getByText(`Diterima dari Farida · ${rp(HALF)} ke ${N_WALLET}`),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);
  const after = await balances();
  expect(after.n).toBe(before.n + HALF);
  expect(await ledgerState()).toMatchObject({ settlements: 1, received: 1 });
  // Laporan Pribadi N: Pemasukan tidak bertambah oleh penerimaan.
  await page.goto('/pribadi/transaksi');
  await expect(main(page).getByText('Terima patungan')).toBeVisible();
});

test('F tidak bisa membatalkan pelunasan yang sudah diterima; N membatalkan penerimaan; F membatalkan pelunasan', async ({
  page,
  partnerPage,
}) => {
  await partnerPage.goto('/bersama/patungan');
  await expect(main(partnerPage)).toContainText(
    'Sudah diterima Novanda. Minta Novanda membatalkan penerimaannya dulu.',
  );
  await expect(main(partnerPage).getByRole('button', { name: /^Batalkan pelunasan/ })).toHaveCount(
    0,
  );

  await page.goto('/bersama/patungan');
  await main(page).getByRole('button', { name: 'Batalkan penerimaan dari Farida' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Batalkan penerimaan?' });
  await expect(dialog).toContainText('Saldo patungan tidak berubah.');
  await expect(dialog.getByRole('button', { name: 'Kembali' })).toBeFocused();
  const before = await balances();
  await dialog.getByRole('button', { name: 'Batalkan penerimaan' }).click();
  await expect(toasts(page).getByText('Penerimaan dibatalkan')).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect((await balances()).n).toBe(before.n - HALF);
  expect(await ledgerState()).toMatchObject({ settlements: 1, received: 0 });
  await expect(main(page).getByRole('region', { name: 'Menunggu diterima' })).toContainText(
    'Terima',
  );

  await partnerPage.goto('/bersama/patungan');
  await main(partnerPage)
    .getByRole('button', { name: /^Batalkan pelunasan/ })
    .click();
  const confirm = partnerPage.getByRole('alertdialog', { name: 'Batalkan pelunasan ini?' });
  await expect(confirm).toContainText('utangmu ke Novanda bertambah lagi');
  await confirm.getByRole('button', { name: 'Batalkan pelunasan' }).click();
  await expect(toasts(partnerPage).getByText('Pelunasan dibatalkan')).toBeVisible();
  expect(await ledgerState()).toMatchObject({ settlements: 0 });
  await partnerPage.goto('/bersama/beranda');
  await expect(card(partnerPage)).toContainText(`Kamu berutang ${rp(HALF)} ke Novanda`);
});

test('N menghapus tagihan lalu memulihkannya; F tidak melihat Patungan dihapus', async ({
  page,
  partnerPage,
}) => {
  await page.goto('/bersama/patungan');
  const before = await balances();
  await main(page)
    .getByRole('button', { name: new RegExp(`^Hapus tagihan patungan ${BILL}`) })
    .click();
  const dialog = page.getByRole('alertdialog', { name: 'Hapus tagihan patungan ini?' });
  await expect(dialog).toContainText(`Uangnya kembali ke ${N_WALLET}.`);
  await expect(dialog).toContainText('Farida berutang sekarang');
  await dialog.getByRole('button', { name: 'Hapus tagihan' }).click();
  await expect(toasts(page).getByText('Tagihan patungan dihapus di Bersama')).toBeVisible();
  expect((await balances()).n).toBe(before.n + AMOUNT);
  await expect(main(page).getByText('Patungan dihapus (1)')).toBeVisible();
  await partnerPage.goto('/bersama/patungan');
  // F hanya melihat yang ia hapus sendiri (pelunasan dibatalkan di tes sebelumnya), bukan tagihan N.
  await expect(main(partnerPage).getByText('Patungan dihapus (1)')).toBeVisible();
  await expect(main(partnerPage).getByRole('button', { name: /^Pulihkan tagihan/ })).toHaveCount(0);
  await expect(main(partnerPage).getByText(BILL)).toHaveCount(0);

  await main(page).getByText('Patungan dihapus (1)').click();
  await main(page)
    .getByRole('button', { name: new RegExp(`^Pulihkan tagihan patungan ${BILL}`) })
    .click();
  await expect(toasts(page).getByText('Tagihan patungan dipulihkan di Bersama')).toBeVisible();
  expect((await balances()).n).toBe(before.n);
  expect(await ledgerState()).toMatchObject({ splits: 1, voided: 0 });
});

test('Pribadi pasangan tidak bocor: HTML, payload RSC, dan navigasi Patungan/Beranda Bersama (N dan F)', async ({
  page,
  partnerPage,
}) => {
  test.setTimeout(180_000);
  const ids = await adminQuery<{ id: string }>(
    `select a.id::text from app.accounts a join app.spaces s on s.id = a.space_id
      where s.kind = 'personal'
     union select id::text from app.spaces where kind = 'personal'`,
  );
  const secrets = [N_WALLET, F_WALLET, 'KANARI', ...ids.map((r) => r.id)];
  for (const [who, p] of [
    ['N', page],
    ['F', partnerPage],
  ] as const) {
    for (const url of ['/bersama/patungan', '/bersama/beranda', '/bersama/aktivitas']) {
      const doc = await bersamaResponses(p, () => p.goto(url));
      expect(doc.unread, `${who} ${url}`).toEqual([]);
      for (const body of doc.bodies) {
        for (const s of secrets) expect(body.includes(s), `${who} ${url}: ${s}`).toBe(false);
      }
      const rsc = await p.evaluate(async (u) => {
        const r = await fetch(`${u}?_rsc`, { headers: { RSC: '1' }, redirect: 'manual' });
        return { status: r.status, body: await r.text() };
      }, url);
      expect(rsc.status, `${who} RSC ${url}`).toBe(200);
      for (const s of secrets) expect(rsc.body.includes(s), `${who} RSC ${url}: ${s}`).toBe(false);
    }
    await p.goto('/bersama/aktivitas');
  }
  // Aktivitas: satu baris pembayaran dari dompet pribadi, tanpa kaki dompet sistem.
  await page.goto('/bersama/aktivitas');
  await expect(
    main(page).getByRole('listitem').filter({ hasText: 'membayar' }).first(),
  ).toContainText(`membayar ${BILL} dari dompet pribadi`);
  await expect(main(page)).not.toContainText('Patungan');
  await expect(main(page)).not.toContainText('menyetor ke Bersama');
});

test('Menu Patungan di Bersama, bukan di Pribadi; solo dan Pribadi tanpa kartu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/bersama/beranda');
  await page.getByRole('button', { name: 'Menu' }).first().click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await menu.getByRole('link', { name: 'Patungan' }).click();
  await expect(page).toHaveURL(/\/bersama\/patungan$/);
  await expect(page.getByRole('heading', { name: 'Patungan · Bersama', level: 1 })).toBeVisible();
  await page.goto('/pribadi/beranda');
  await page.getByRole('button', { name: 'Menu' }).first().click();
  await expect(
    page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Patungan' }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(main(page).getByRole('heading', { name: 'Saldo patungan' })).toHaveCount(0);
});

test('axe dan 320 px: Patungan, Beranda Bersama, sheet Lunasi dan dialog; budget JS', async ({
  page,
  partnerPage,
  browser,
  ownerState,
}) => {
  test.setTimeout(180_000);
  for (const p of [page, partnerPage]) {
    await p.goto('/bersama/patungan');
    await expect(main(p).getByRole('heading', { name: 'Patungan · Bersama' })).toBeVisible();
    await checkScreen(p);
    await p.goto('/bersama/beranda');
    await expect(card(p)).toBeVisible();
    await checkScreen(p);
  }
  // Sheet Lunasi terbuka di 320: tanpa gulir horizontal, tanpa pelanggaran serius.
  await partnerPage.setViewportSize({ width: 320, height: 720 });
  await partnerPage.goto('/bersama/patungan?lunasi=1');
  const sheet = partnerPage.getByRole('dialog', { name: /^Lunasi patungan\W*Bersama$/ });
  await expect(sheet.getByRole('textbox', { name: 'Jumlah dilunasi' })).toBeVisible();
  await noHorizontalScroll(partnerPage);
  await expectNoSeriousViolations(partnerPage, { tags: WCAG_TAGS });
  await partnerPage.keyboard.press('Escape');
  // Dialog akibat di 320.
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/bersama/patungan');
  await main(page)
    .getByRole('button', { name: new RegExp(`^Hapus tagihan patungan ${BILL}`) })
    .click();
  await expect(
    page.getByRole('alertdialog', { name: 'Hapus tagihan patungan ini?' }),
  ).toBeVisible();
  await noHorizontalScroll(page);
  await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
  await page.getByRole('button', { name: 'Kembali' }).click();
  // Budget JS (batas 162 kB) rute Bersama dan Patungan.
  for (const url of ['/bersama/beranda', '/bersama/patungan']) {
    await expectRouteBudget(browser, ownerState, url);
  }
});
