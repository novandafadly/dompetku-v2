import { expect, test } from '@playwright/test';

test.describe('tema gelap bawaan', () => {
  // Preferensi sistem terang tidak mengubah bawaan: tidak ada media query tema.
  test.use({ colorScheme: 'light' });

  test('tanpa ?theme: html[data-theme=dark] dan bg gelap DESIGN.md (#0D0E11)', async ({ page }) => {
    await page.goto('/pribadi/beranda');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(13, 14, 17)');
  });
});

test.describe('tema terang', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 390, height: 844 } });

  test('?theme=light: bg terang (#EEF0F3) dan ikut saat pindah tab', async ({ page }) => {
    await page.goto('/pribadi/beranda?theme=light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(238, 240, 243)');
    await page
      .getByRole('navigation', { name: 'Tab utama' })
      .getByRole('link', { name: 'Dompet' })
      .click();
    await expect(page).toHaveURL(/\/pribadi\/dompet\?theme=light$/);
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(238, 240, 243)');
  });
});
