import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoSeriousViolations, WCAG_TAGS } from './axe';
import { ROUTES, TODAY } from './routes';

/** Tunggu halaman siap diperiksa: banner demo tampil dan tidak ada muatan tertunda. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByText('Data demo').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** Tombol Catat yang terlihat: tab bar (mobile) atau sidebar (desktop). */
function catatButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Catat', exact: true }).filter({ visible: true });
}

async function animationsDone(el: Locator) {
  await el.evaluate((node) =>
    Promise.all(node.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
}

/** Tema lewat ?theme (bawaan gelap); preferensi sistem tidak dipakai. */
const themed = (path: string, theme: 'light' | 'dark') =>
  theme === 'light' ? `${path}&theme=light` : path;

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1280]) {
    test.describe(`axe ${theme} ${String(width)}`, () => {
      test.use({ viewport: { width, height: width === 390 ? 844 : 800 } });

      for (const route of ROUTES) {
        test(route.name, async ({ page }) => {
          await open(page, themed(route.path, theme));
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
        });
      }

      test('sheet Catat terbuka', async ({ page }) => {
        await open(page, themed(`/pribadi/beranda?seed=full&today=${TODAY}`, theme));
        await catatButton(page).click();
        const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
        await expect(sheet.getByLabel('Nominal', { exact: true })).toBeFocused();
        await animationsDone(sheet);
        await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      });
    });
  }
}

test.describe('320 px', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const route of ROUTES) {
    test(`no horizontal scroll at 320: ${route.name}`, async ({ page }) => {
      await open(page, route.path);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(320);
    });
  }
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });

  test('sheet Catat tampil instan', async ({ page }) => {
    await open(page, `/pribadi/beranda?seed=full&today=${TODAY}`);
    await catatButton(page).click();
    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    await expect(sheet).toBeVisible();
    const timing = await sheet.evaluate((el) => {
      const style = getComputedStyle(el);
      return { transition: style.transitionDuration, animation: style.animationDuration };
    });
    expect(timing).toEqual({ transition: '0s', animation: '0s' });
  });
});

test.describe('keyboard only', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('catat pengeluaran dengan Tab/Enter/panah; Escape mengembalikan fokus ke Catat', async ({
    page,
  }) => {
    await open(page, `/pribadi/beranda?seed=full&today=${TODAY}`);
    const catat = catatButton(page);

    // Tab dari awal dokumen sampai tombol Catat.
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      if (await catat.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(catat).toBeFocused();
    await page.keyboard.press('Enter');

    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    await expect(sheet.getByLabel('Nominal', { exact: true })).toBeFocused();
    await page.keyboard.type('35000');

    // Tab masuk ke grup chip (satu tab stop), lalu panah memilih chip berikutnya.
    const chips = sheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio');
    await page.keyboard.press('Tab');
    await expect(chips.first()).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(chips.nth(1)).toBeFocused();
    await expect(chips.nth(1)).toHaveAttribute('aria-checked', 'true');
    const category = (await chips.nth(1).innerText()).trim();

    const simpan = sheet.getByRole('button', { name: 'Simpan' });
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      if (await simpan.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(simpan).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page
        .getByRole('region', { name: /Notifikasi/ })
        .getByText('Tersimpan di Pribadi · Rp 35.000 dari BCA'),
    ).toBeVisible();
    await expect(
      page
        .getByRole('main')
        .getByRole('region', { name: 'Terakhir' })
        .getByRole('listitem')
        .first(),
    ).toContainText(category);

    // Buka lagi dari keyboard, lalu Escape: sheet tertutup, fokus kembali ke Catat.
    await expect(catat).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sheet.getByLabel('Nominal', { exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(catat).toBeFocused();
  });
});
