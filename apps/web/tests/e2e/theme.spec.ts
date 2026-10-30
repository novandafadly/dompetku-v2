import { expect, test } from '@playwright/test';

test.describe('tema mengikuti sistem', () => {
  test.use({ colorScheme: 'dark' });

  test('body memakai bg gelap A.1 (#121210)', async ({ page }) => {
    await page.goto('/pribadi/beranda');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(18, 18, 16)');
  });
});

test.describe('tema terang', () => {
  test.use({ colorScheme: 'light' });

  test('body memakai bg terang A.1 (#F6F4EF)', async ({ page }) => {
    await page.goto('/pribadi/beranda');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(246, 244, 239)');
  });
});
