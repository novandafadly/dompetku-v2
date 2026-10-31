import { expect, test } from '@playwright/test';
import { routeScripts } from './route-scripts';

const DARK_BG = 'rgb(15, 18, 17)';
const LIGHT_BG = 'rgb(244, 246, 243)';

test.describe('tema gelap bawaan', () => {
  // Tanpa pilihan tersimpan, preferensi sistem terang tidak mengubah bawaan gelap.
  test.use({ colorScheme: 'light' });

  test('tanpa ?theme dan tanpa pilihan: html[data-theme=dark] dan bg #0F1211', async ({ page }) => {
    await page.goto('/pribadi/beranda');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', DARK_BG);
  });
});

test.describe('tema terang', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 390, height: 844 } });

  test('?theme=light: bg #F4F6F3 dan ikut saat pindah tab', async ({ page }) => {
    await page.goto('/pribadi/beranda?theme=light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', LIGHT_BG);
    await page
      .getByRole('navigation', { name: 'Tab utama' })
      .getByRole('link', { name: 'Dompet' })
      .click();
    await expect(page).toHaveURL(/\/pribadi\/dompet\?theme=light$/);
    await expect(page.locator('body')).toHaveCSS('background-color', LIGHT_BG);
  });

  test('?theme=light diterapkan sebelum JS aplikasi jalan (tanpa kilasan gelap)', async ({
    page,
  }) => {
    // Semua skrip aplikasi ditahan: hanya skrip kepala inline yang bisa menyetel tema.
    let own = new Set<string>();
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.resourceType() === 'document') {
        const response = await route.fetch();
        const body = await response.text();
        own = routeScripts(body);
        await route.fulfill({ response, body });
        return;
      }
      if (new URL(request.url()).pathname.endsWith('.js')) {
        await route.abort();
        return;
      }
      await route.continue();
    });
    await page.goto('/pribadi/beranda?theme=light');
    expect(own.size).toBeGreaterThan(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', LIGHT_BG);
  });
});

test.describe('Menu → Tampilan', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  async function choose(page: import('@playwright/test').Page, label: string) {
    await page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
    const dialog = page.getByRole('dialog', { name: 'Menu' });
    const group = dialog.getByRole('radiogroup', { name: 'Tampilan' });
    await expect(group.getByRole('radio')).toHaveText(['Gelap', 'Terang', 'Ikuti sistem']);
    await group.getByRole('radio', { name: label }).click();
    await expect(group.getByRole('radio', { name: label })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
  }

  test('Terang tersimpan di localStorage dan bertahan setelah muat ulang', async ({ page }) => {
    await page.goto('/pribadi/beranda');
    await choose(page, 'Terang');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', LIGHT_BG);
    expect(await page.evaluate(() => localStorage.getItem('dompetku-theme'))).toBe('light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', LIGHT_BG);
    // ?theme menang atas pilihan tersimpan (tautan pratinjau).
    await page.goto('/pribadi/beranda?theme=dark');
    await expect(page.locator('body')).toHaveCSS('background-color', DARK_BG);
  });

  test('Ikuti sistem mengikuti prefers-color-scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/pribadi/beranda');
    await expect(page.locator('body')).toHaveCSS('background-color', DARK_BG);
    await choose(page, 'Ikuti sistem');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
    await expect(page.locator('body')).toHaveCSS('background-color', LIGHT_BG);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('body')).toHaveCSS('background-color', DARK_BG);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
  });

  test('penyimpanan diblokir: pilihan tetap berlaku di halaman ini', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('diblokir');
        },
      });
    });
    await page.goto('/pribadi/beranda');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await choose(page, 'Terang');
    await expect(page.locator('body')).toHaveCSS('background-color', LIGHT_BG);
  });
});
