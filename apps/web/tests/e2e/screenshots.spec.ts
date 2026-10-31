import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { ROUTES } from './routes';

/**
 * Screenshot untuk pratinjau pemilik. Bertag @screens: tidak ikut `pnpm e2e` biasa maupun CI
 * (lihat playwright.config.ts); jalankan dengan `pnpm e2e:screens` (SCREENS=1).
 */
const OUT_DIR = fileURLToPath(new URL('../../../../docs/screenshots/m0a/', import.meta.url));

for (const theme of ['dark', 'light'] as const) {
  for (const width of [390, 1280]) {
    test.describe(`screens ${theme} ${String(width)}`, () => {
      test.use({
        reducedMotion: 'reduce',
        viewport: { width, height: width === 390 ? 844 : 800 },
      });

      for (const route of ROUTES.filter((r) => r.screenshot)) {
        const file = `${route.name}-${String(width)}-${theme}.png`;
        test(file, { tag: '@screens' }, async ({ page }) => {
          await page.goto(theme === 'light' ? `${route.path}&theme=light` : route.path);
          await expect(
            page
              .getByText(/^(Data demo|Prototipe: belum aktif)$/)
              .filter({ visible: true })
              .first(),
          ).toBeVisible();
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await page.waitForLoadState('networkidle');
          await page.evaluate(() => document.fonts.ready);
          if (route.fullPage) {
            // Viewport setinggi dokumen: tab bar dan elemen fixed lain mendarat di bawah,
            // bukan menimpa isi di tengah seperti pada fullPage.
            const height = await page.evaluate(() => document.documentElement.scrollHeight);
            await page.setViewportSize({
              width,
              height: Math.max(height, width === 390 ? 844 : 800),
            });
            await page.evaluate(() => document.fonts.ready);
          }
          await page.screenshot({ path: OUT_DIR + file, animations: 'disabled' });
        });
      }
    });
  }
}
