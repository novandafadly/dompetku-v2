import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Screenshot bingkai S7-C1 (transfer antar ruang) dan S7-C2 (talangan) di mode prototipe, untuk
 * design reviewer. Bertag @screens: tidak ikut `pnpm e2e` biasa; jalankan dengan
 * `SCREENS=1 playwright test screenshots-s7` (deviceScaleFactor 1).
 */
const OUT_DIR = fileURLToPath(new URL('../../../../docs/design/s7/', import.meta.url));
const q = 'today=2026-10-17';

async function open(page: Page, theme: 'dark' | 'light') {
  await page.goto(`/pribadi/beranda?${q}${theme === 'light' ? '&theme=light' : ''}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.getByRole('button', { name: 'Catat', exact: true }).filter({ visible: true }).click();
  await expect(page.getByLabel('Nominal', { exact: true })).toBeFocused();
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // Menutup fokus visual pada input agar bidikan stabil.
  await page.waitForTimeout(250);
}

for (const theme of ['dark', 'light'] as const) {
  for (const width of [390, 1280]) {
    test.describe(`screens S7 ${theme} ${String(width)}`, () => {
      test.use({
        reducedMotion: 'reduce',
        viewport: { width, height: width === 390 ? 844 : 800 },
      });

      test(`c1 ${theme} ${String(width)}`, { tag: '@screens' }, async ({ page }) => {
        await open(page, theme);
        const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
        await sheet.getByRole('button', { name: 'Pengeluaran · Pribadi' }).click();
        await page.getByRole('menuitemradio', { name: 'Transfer' }).click();
        const tf = page.getByRole('dialog', { name: 'Transfer · Pribadi' });
        await tf.getByLabel('Nominal', { exact: true }).fill('250000');
        // Halaman dalam: daftar dompet ruang tujuan.
        await tf.getByRole('button', { name: 'Pilih dompet di ruang lain' }).click();
        await expect(page.getByRole('radiogroup', { name: 'Dompet di Bersama' })).toBeVisible();
        await settle(page);
        await page.screenshot({
          path: `${OUT_DIR}c1-halaman-ruang-lain-${String(width)}-${theme}.png`,
          animations: 'disabled',
        });
        await page.getByRole('radio', { name: /Kas Rumah/ }).click();
        const done = page.getByRole('dialog', { name: 'Transfer · Pribadi → Bersama' });
        // Tablet ke atas: kolom keterangan selalu terbuka (tombolnya tersembunyi).
        if (width < 600) await done.getByRole('button', { name: 'Tambah keterangan' }).click();
        await done.getByLabel(/Keterangan \(hanya di Pribadi\)/).fill('Bayar kos adik');
        await done.getByLabel(/Catatan untuk Bersama/).fill('Setoran bulanan');
        await settle(page);
        await page.screenshot({
          path: `${OUT_DIR}c1-transfer-antar-ruang-${String(width)}-${theme}.png`,
          animations: 'disabled',
        });
      });

      test(`c2 ${theme} ${String(width)}`, { tag: '@screens' }, async ({ page }) => {
        await open(page, theme);
        const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
        await sheet.getByLabel('Nominal', { exact: true }).fill('150000');
        await sheet
          .getByRole('radiogroup', { name: 'Kategori' })
          .getByRole('radio')
          .first()
          .click();
        await sheet.getByRole('switch', { name: 'Talangan kantor' }).click();
        await expect(sheet.getByRole('switch', { name: 'Talangan kantor' })).toHaveAttribute(
          'aria-checked',
          'true',
        );
        await settle(page);
        await page.screenshot({
          path: `${OUT_DIR}c2-talangan-${String(width)}-${theme}.png`,
          animations: 'disabled',
        });
      });
    });
  }

  test.describe(`screens S7 keyboard ${theme}`, () => {
    test.use({ reducedMotion: 'reduce', viewport: { width: 360, height: 640 - 284 } });

    test(`c2 keyboard 360 ${theme}`, { tag: '@screens' }, async ({ page }) => {
      await open(page, theme);
      const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
      await page.keyboard.type('150000');
      await sheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio').first().click();
      await sheet.getByRole('switch', { name: 'Talangan kantor' }).click();
      await settle(page);
      await page.screenshot({
        path: `${OUT_DIR}c2-talangan-keyboard-360-${theme}.png`,
        animations: 'disabled',
      });
    });
  });
}
