import { expect, test } from '@playwright/test';

test('/ redirects to /pribadi/beranda and shows demo banner', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/pribadi\/beranda$/);
  await expect(page.getByText('Data demo')).toBeVisible();
});
