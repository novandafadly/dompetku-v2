import { expect, test } from '@playwright/test';

test.describe('mobile 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('tab bar: lima slot berurutan, Catat tombol, tab aktif aria-current', async ({ page }) => {
    await page.goto('/pribadi/transaksi');
    const bar = page.getByRole('navigation', { name: 'Tab utama' });
    await expect(bar).toBeVisible();
    const labels = await bar.locator('a, button').allInnerTexts();
    expect(labels.map((t) => t.trim())).toEqual([
      'Beranda',
      'Transaksi',
      'Catat',
      'Dompet',
      'Rencana',
    ]);
    await expect(bar.getByRole('button', { name: 'Catat' })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Transaksi' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(bar.getByRole('link', { name: 'Beranda' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('pengalih ke Bersama mengubah URL, data-ruang, dan label header', async ({ page }) => {
    await page.goto('/pribadi/beranda');
    const header = page.getByRole('banner');
    await expect(header.getByRole('radio', { name: 'Pribadi' })).toBeChecked();
    await header.getByRole('radio', { name: 'Bersama' }).click();
    await expect(page).toHaveURL(/\/bersama\/beranda$/);
    await expect(page.locator('html')).toHaveAttribute('data-ruang', 'bersama');
    await expect(header.getByRole('radio', { name: 'Bersama' })).toBeChecked();
    await expect(header.getByText('Bersama', { exact: true })).toBeVisible();
  });

  test('query seed/today/hero ikut saat pindah tab dan ruang', async ({ page }) => {
    await page.goto('/pribadi/beranda?seed=full&today=2026-10-30&hero=sans');
    await page
      .getByRole('navigation', { name: 'Tab utama' })
      .getByRole('link', { name: 'Dompet' })
      .click();
    await expect(page).toHaveURL(/\/pribadi\/dompet\?seed=full&today=2026-10-30&hero=sans$/);
    await page.getByRole('banner').getByRole('radio', { name: 'Bersama' }).click();
    await expect(page).toHaveURL(/\/bersama\/dompet\?seed=full&today=2026-10-30&hero=sans$/);
    await expect(page.locator('html')).toHaveAttribute('data-hero', 'sans');
  });

  test('Menu membuka sheet; item non-M0a berlabel Segera', async ({ page }) => {
    await page.goto('/pribadi/beranda');
    await page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
    const dialog = page.getByRole('dialog', { name: 'Menu' });
    await expect(dialog).toBeVisible();
    for (const name of ['Trip', 'Kategori', 'Kontak', 'Export', 'Analisis', 'Pengaturan']) {
      const item = dialog.getByRole('button', { name: new RegExp(name) });
      await expect(item).toContainText('Segera');
      await expect(item).toHaveAttribute('aria-disabled', 'true');
    }
    await expect(page).toHaveURL(/\/pribadi\/beranda$/);
  });

  test('Catat membuka sheet; pintasan c hanya di luar field teks', async ({ page }) => {
    await page.goto('/pribadi/beranda');
    await page
      .getByRole('navigation', { name: 'Tab utama' })
      .getByRole('button', { name: 'Catat' })
      .click();
    await expect(page.getByRole('dialog', { name: 'Catat' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('c');
    await expect(page.getByRole('dialog', { name: 'Catat' })).toBeVisible();
  });

  test('seed=empty menyembunyikan Rencana; seed=full menampilkannya', async ({ page }) => {
    const bar = page.getByRole('navigation', { name: 'Tab utama' });
    await page.goto('/pribadi/beranda?seed=empty');
    await expect(bar.getByRole('link', { name: 'Dompet' })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Rencana' })).toHaveCount(0);
    await page.goto('/pribadi/beranda?seed=full');
    await expect(bar.getByRole('link', { name: 'Rencana' })).toBeVisible();
  });
});

test.describe('desktop 1280', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('sidebar 248 px: pengalih, Catat, lima grup; tab bar tersembunyi', async ({ page }) => {
    await page.goto('/pribadi/beranda');
    const side = page.getByRole('complementary', { name: 'Sidebar' });
    await expect(side).toBeVisible();
    expect((await side.boundingBox())?.width).toBe(248);
    await expect(side.getByRole('radio', { name: 'Pribadi' })).toBeChecked();
    await expect(side.getByRole('button', { name: 'Catat' })).toBeVisible();
    const nav = side.getByRole('navigation', { name: 'Navigasi utama' });
    const labels = await nav.locator('a, button').allInnerTexts();
    expect(labels.map((t) => t.trim())).toEqual([
      'Beranda',
      'Transaksi',
      'Dompet',
      'Rencana',
      'Menu',
    ]);
    await expect(page.getByRole('navigation', { name: 'Tab utama' })).toBeHidden();
    await side.getByRole('radio', { name: 'Bersama' }).click();
    await expect(page).toHaveURL(/\/bersama\/beranda$/);
  });
});

test('ruang tidak dikenal menghasilkan 404', async ({ page }) => {
  const res = await page.goto('/lainnya/beranda');
  expect(res?.status()).toBe(404);
  await expect(page.getByText('This page could not be found')).toBeVisible();
});
