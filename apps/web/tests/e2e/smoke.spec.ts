import { expect, test } from '@playwright/test';

test('/ redirects to /pribadi/beranda and shows demo banner', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/pribadi\/beranda$/);
  await expect(page.getByText('Data demo').filter({ visible: true })).toBeVisible();
});

test('security headers are sent on /pribadi/beranda', async ({ request }) => {
  const res = await request.get('/pribadi/beranda');
  const h = res.headers();
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('same-origin');
  expect(h['permissions-policy']).toContain('camera=(), microphone=(), geolocation=()');
});
