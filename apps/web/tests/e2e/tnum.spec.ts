import { expect, test } from '@playwright/test';

test('angka tabular: lebar 1111111 sama dengan 0000000', async ({ page }) => {
  await page.goto('/dev/ui#angka');
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === 'loaded').length;
  });
  expect(loaded).toBeGreaterThan(0);
  const widths = await page
    .locator('#angka .num')
    .evaluateAll((els) =>
      Object.fromEntries(els.map((el) => [el.textContent, el.getBoundingClientRect().width])),
    );
  const narrow = widths['1111111'];
  const wide = widths['0000000'];
  expect(narrow).toBeGreaterThan(0);
  expect(Math.abs((narrow ?? 0) - (wide ?? 0))).toBeLessThanOrEqual(0.5);
});
