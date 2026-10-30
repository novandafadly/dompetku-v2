import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { ROUTES } from './routes';

/**
 * Screenshot untuk pratinjau pemilik. Bertag @screens: tidak ikut `pnpm e2e` biasa maupun CI
 * (lihat playwright.config.ts); jalankan dengan `pnpm e2e:screens` (SCREENS=1).
 */
const OUT_DIR = fileURLToPath(new URL('../../../../docs/screenshots/m0a/', import.meta.url));

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [390, 1280]) {
    test.describe(`screens ${colorScheme} ${String(width)}`, () => {
      test.use({
        colorScheme,
        reducedMotion: 'reduce',
        viewport: { width, height: width === 390 ? 844 : 800 },
      });

      for (const route of ROUTES.filter((r) => r.screenshot)) {
        const heroes = route.heroVariants ? (['serif', 'sans'] as const) : (['serif'] as const);
        for (const hero of heroes) {
          const file = `${route.name}-${String(width)}-${colorScheme}-${hero}.png`;
          test(file, { tag: '@screens' }, async ({ page }) => {
            await page.goto(hero === 'sans' ? `${route.path}&hero=sans` : route.path);
            await expect(page.getByText('Data demo').first()).toBeVisible();
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
      }
    });
  }
}
