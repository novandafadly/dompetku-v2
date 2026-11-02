import { expect, test } from '@playwright/test';

/**
 * Navigasi shell di Sampah (layar di luar tab): tab bar dan sidebar menandai induknya, Transaksi
 * (bukan Beranda), dan pengalih ruang tetap di Sampah ruang lain.
 */

const q = 'today=2026-10-17';

test.describe('Sampah di shell, HP', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('tab bar menandai Transaksi; pengalih ruang membuka Sampah Bersama', async ({ page }) => {
    await page.goto(`/pribadi/sampah?${q}`);
    const tabs = page.getByRole('navigation', { name: 'Tab utama' });
    await expect(tabs.getByRole('link', { name: 'Transaksi' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(tabs.getByRole('link', { name: 'Beranda' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    await page
      .getByRole('banner')
      .getByRole('navigation', { name: 'Ruang' })
      .getByRole('link', { name: 'Bersama' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/bersama/sampah\\?${q}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Sampah · Bersama' })).toBeVisible();
  });
});

test.describe('Sampah di shell, laptop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('sidebar menandai Transaksi', async ({ page }) => {
    await page.goto(`/bersama/sampah?${q}`);
    const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
    await expect(nav.getByRole('link', { name: 'Transaksi' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(
      page.getByRole('complementary', { name: 'Sidebar' }).getByRole('link', { name: 'Pribadi' }),
    ).toHaveAttribute('href', `/pribadi/sampah?${q}`);
  });
});
