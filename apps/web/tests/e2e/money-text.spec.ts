import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 320, height: 640 } });

test('MoneyText hero Rp 12.345.678.900 utuh di 320px tanpa scroll horizontal', async ({ page }) => {
  await page.goto('/dev/ui#angka');
  const hero = page.getByTestId('angka-besar');
  await expect(hero).toBeVisible();
  await expect(hero).toContainText('Rp 12.345.678.900');
  const box = await hero.locator('.num').boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(320);
});
