import { balances, createSeed } from '@dompetku/demo-data';
import type { Pocket } from '@dompetku/demo-data';
import { formatRupiah } from '@dompetku/domain';
import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousViolations } from './axe';

const TODAY = '2026-10-17';
const q = `today=${TODAY}`;
const full = createSeed({ today: TODAY, variant: 'full' });

function subtotal(ruang: 'pribadi' | 'bersama', pockets: Pocket[]): number {
  const bal = balances(full, ruang);
  return full.accounts
    .filter((a) => a.ruang === ruang && pockets.includes(a.pocket))
    .reduce((sum, a) => sum + (bal.get(a.id) ?? 0), 0);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('Dompet', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('dikelompokkan per pocket dengan subtotal; kekayaan bersih tanpa Kantor', async ({
    page,
  }) => {
    await page.goto(`/pribadi/dompet?${q}`);
    const main = page.getByRole('main');
    const bal = balances(full, 'pribadi');
    for (const [name, pockets] of [
      ['Operasional', ['operasional']],
      ['Tabungan', ['tabungan']],
      ['Kantor', ['kantor']],
    ] as const) {
      const group = main.getByRole('region', { name, exact: true });
      await expect(group).toContainText(formatRupiah(subtotal('pribadi', [...pockets])));
    }
    const ops = main.getByRole('region', { name: 'Operasional', exact: true });
    for (const a of full.accounts.filter(
      (x) => x.ruang === 'pribadi' && x.pocket === 'operasional',
    )) {
      await expect(ops.getByRole('link', { name: new RegExp(a.name) })).toContainText(
        formatRupiah(bal.get(a.id) ?? 0),
      );
    }
    const kantor = main.getByRole('region', { name: 'Kantor', exact: true });
    await expect(kantor.getByText('Tidak masuk hitungan pribadi')).toBeVisible();

    const net = subtotal('pribadi', ['operasional', 'tabungan']);
    await expect(main.getByText('Kekayaan bersih')).toBeVisible();
    await expect(page.getByTestId('net-worth')).toContainText(formatRupiah(net));
    await expect(page.getByTestId('net-worth')).not.toContainText(
      formatRupiah(net + subtotal('pribadi', ['kantor'])),
    );

    await page.goto(`/pribadi/beranda?${q}`);
    await expect(page.getByText(/kekayaan bersih/i)).toHaveCount(0);
  });

  test('Bersama: tanpa Kantor, kekayaan bersih Bersama', async ({ page }) => {
    await page.goto(`/bersama/dompet?${q}`);
    const main = page.getByRole('main');
    await expect(main.getByRole('region', { name: 'Kantor', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('net-worth')).toContainText(
      formatRupiah(subtotal('bersama', ['operasional', 'tabungan'])),
    );
  });

  test('riwayat dompet: saldo dan entri per hari; ruang lain atau id asing 404', async ({
    page,
  }) => {
    const bca = full.accounts.find((a) => a.id === 'acc-bca');
    if (!bca) throw new Error('seed tanpa BCA');
    await page.goto(`/pribadi/dompet?${q}`);
    await page.getByRole('main').getByRole('link', { name: /BCA/ }).click();
    await expect(page).toHaveURL(new RegExp(`/pribadi/dompet/acc-bca\\?${q}$`));
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'BCA' })).toBeVisible();
    await expect(page.getByTestId('wallet-balance')).toContainText(
      formatRupiah(balances(full, 'pribadi').get('acc-bca') ?? 0),
    );
    await expect(main.getByRole('listitem').first()).toBeVisible();

    await page.goto(`/bersama/dompet/acc-bca?${q}`);
    await expect(page.getByText('This page could not be found.')).toBeVisible();
    await page.goto(`/pribadi/dompet/tidak-ada?${q}`);
    await expect(page.getByText('This page could not be found.')).toBeVisible();
  });

  test('lolos axe dan tanpa gulir horizontal di 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/pribadi/dompet?${q}`);
    await expect(page.getByTestId('net-worth')).toBeVisible();
    await expectNoSeriousViolations(page);
    await noHorizontalScroll(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectNoSeriousViolations(page);
  });
});

test.describe('Tambah dompet', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('BCA Operasional 4.100.000: saldo awal di riwayat, checklist dan kalimat aman dipakai', async ({
    page,
  }) => {
    await page.goto(`/pribadi/dompet?seed=empty&${q}`);
    await page.getByRole('main').getByRole('button', { name: 'Tambah dompet' }).click();
    const sheet = page.getByRole('dialog', { name: /Dompet baru/ });
    await sheet.getByLabel('Nama').fill('BCA');
    await sheet.getByRole('radio', { name: 'Operasional' }).click();
    await expect(sheet.getByRole('radio', { name: 'Bank' })).toBeChecked();
    await sheet.getByLabel('Saldo hari ini').fill('4100000');
    await sheet.getByRole('button', { name: 'Simpan dompet' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page
        .getByRole('region', { name: /Notifikasi/ })
        .getByText('Dompet BCA ditambahkan di Pribadi'),
    ).toBeVisible();

    const main = page.getByRole('main');
    await main.getByRole('link', { name: /BCA/ }).click();
    await expect(main.getByRole('heading', { level: 1, name: 'BCA' })).toBeVisible();
    await expect(page.getByTestId('wallet-balance')).toContainText(formatRupiah(4_100_000));
    await expect(main.getByRole('listitem').filter({ hasText: 'Saldo awal' })).toContainText(
      `Saldo awal ${formatRupiah(4_100_000)}`,
    );

    await page
      .getByRole('navigation', { name: 'Tab utama' })
      .getByRole('link', { name: 'Beranda' })
      .click();
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Aman dipakai sampai 31 Okt');
    await expect(page.getByTestId('hero-amount')).toContainText(formatRupiah(4_100_000));
    const steps = main.getByRole('list', { name: 'Mulai dari sini' }).getByRole('listitem');
    await expect(steps.nth(1)).toContainText('Tambah dompet sehari-hari');
    await expect(steps.nth(1)).toContainText('Selesai');
    await expect(steps.nth(2)).toContainText('Belum');
  });

  test('tanpa saldo: dompet dibuat tanpa entri Saldo awal', async ({ page }) => {
    await page.goto(`/pribadi/dompet?seed=empty&${q}`);
    await page.getByRole('main').getByRole('button', { name: 'Tambah dompet' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Nama').fill('Tabungan Nikah');
    await sheet.getByRole('radio', { name: 'Tabungan' }).click();
    await sheet.getByRole('radio', { name: 'E-wallet' }).click();
    await sheet.getByRole('button', { name: 'Simpan dompet' }).click();
    const main = page.getByRole('main');
    await main.getByRole('link', { name: /Tabungan Nikah/ }).click();
    await expect(main.getByText('Saldo awal')).toHaveCount(0);
    await expect(main.getByText('Belum ada transaksi di dompet ini.')).toBeVisible();
  });

  test('validasi inline; Kantor hanya di Pribadi; dompet ganda ditolak', async ({ page }) => {
    await page.goto(`/pribadi/dompet?${q}`);
    await page.getByRole('main').getByRole('button', { name: 'Tambah dompet' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('radio', { name: 'Kantor' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Simpan dompet' }).click();
    await expect(sheet.getByText('Isi nama dompet.')).toBeVisible();
    await expect(sheet.getByText('Pilih jenis dompet.')).toBeVisible();
    await expect(sheet).toBeVisible();
    await sheet.getByLabel('Nama').fill('bca');
    await sheet.getByRole('radio', { name: 'Operasional' }).click();
    await sheet.getByRole('button', { name: 'Simpan dompet' }).click();
    await expect(sheet.getByText('Dompet bernama BCA sudah ada di Pribadi.')).toBeVisible();

    await page.goto(`/bersama/dompet?${q}`);
    await page.getByRole('main').getByRole('button', { name: 'Tambah dompet' }).click();
    await expect(page.getByRole('dialog').getByRole('radio', { name: 'Tabungan' })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('radio', { name: 'Kantor' })).toHaveCount(0);
  });

  test('dari checklist Beranda; Undang Farida menuju /undang', async ({ page }) => {
    await page.goto(`/pribadi/beranda?seed=empty&${q}`);
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Tambah dompet sehari-hari' }).click();
    await expect(page.getByRole('dialog', { name: /Dompet baru/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await main.getByRole('link', { name: 'Undang Farida' }).click();
    await expect(page).toHaveURL(new RegExp(`/undang\\?seed=empty&${q}$`));
  });

  test('sheet muat di 320 px tanpa gulir horizontal dan lolos axe', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`/pribadi/dompet?${q}`);
    await page.getByRole('main').getByRole('button', { name: 'Tambah dompet' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoSeriousViolations(page);
    await noHorizontalScroll(page);
  });
});

test.describe('Layar auth tiruan', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  async function open(page: Page, path: string, heading: string | RegExp) {
    await page.goto(`${path}?${q}`);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText('Prototipe — belum aktif')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Tab utama' })).toHaveCount(0);
  }

  /** Field kata sandi tiruan: tidak diisi otomatis, dan memperingatkan agar tidak memakai sandi asli. */
  async function expectMockPassword(page: Page) {
    const password = page.getByLabel('Kata sandi');
    await expect(password).toHaveAttribute('autocomplete', 'off');
    await expect(page.getByText('Prototipe: jangan isi kata sandi asli.')).toBeVisible();
    await expect(password).toHaveAccessibleDescription('Prototipe: jangan isi kata sandi asli.');
  }

  async function check(page: Page) {
    await expectNoSeriousViolations(page);
    await noHorizontalScroll(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectNoSeriousViolations(page);
  }

  test('masuk', async ({ page }) => {
    await open(page, '/masuk', 'Masuk ke dompetmu');
    await expect(page.getByRole('link', { name: 'Masuk dengan passkey' })).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveAttribute('autocomplete', 'email');
    await expectMockPassword(page);
    await check(page);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/amankan\\?${q}$`));
  });

  test('amankan: passkey lalu kode TOTP lalu kode pemulihan', async ({ page }) => {
    await open(page, '/amankan', 'Amankan akunmu');
    await expect(page.getByText('Langkah 1 dari 2')).toBeVisible();
    await check(page);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.getByRole('button', { name: 'Buat passkey' }).click();
    await expect(page.getByText('Langkah 2 dari 2')).toBeVisible();
    const code = page.getByLabel('Kode 6 angka');
    await expect(code).toHaveAttribute('inputmode', 'numeric');
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await check(page);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.getByRole('button', { name: 'Simpan dan lanjut' }).click();
    await expect(page.getByText('Masukkan 6 angka.')).toBeVisible();
    await code.fill('123456');
    await page.getByRole('button', { name: 'Simpan dan lanjut' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Simpan kode pemulihan' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Ke Beranda' }).click();
    await expect(page).toHaveURL(new RegExp(`/pribadi/beranda\\?${q}$`));
  });

  test('undang', async ({ page }) => {
    await open(page, '/undang', 'Undang Farida');
    await expect(page.getByText('Tautan berlaku 72 jam, sekali pakai.')).toBeVisible();
    await check(page);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.getByRole('button', { name: 'Buat tautan undangan' }).click();
    await expect(page.getByText('Isi email Farida.')).toBeVisible();
    await page.getByLabel('Email Farida').fill('farida@example.com');
    await page.getByRole('button', { name: 'Buat tautan undangan' }).click();
    await page.getByRole('link', { name: 'Buka sebagai Farida' }).click();
    await expect(page).toHaveURL(new RegExp(`/terima-undangan\\?${q}$`));
  });

  test('terima-undangan', async ({ page }) => {
    await open(page, '/terima-undangan', 'Novanda mengundang kamu ke ruang Bersama');
    await expect(page.getByLabel('Email')).toHaveValue('farida@example.com');
    await expectMockPassword(page);
    await check(page);
  });
});
