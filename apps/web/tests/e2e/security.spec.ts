import { expect, test, type Page } from '@playwright/test';
import { ROUTES } from './routes';

/** Kumpulkan pelanggaran CSP (enforce maupun report-only) sejak dokumen pertama. */
async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

test('header keamanan dan CSP bernonce di halaman', async ({ request }) => {
  const res = await request.get('/pribadi/beranda');
  expect(res.status()).toBe(200);
  const h = res.headers();
  const csp = h['content-security-policy'] ?? '';
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).not.toContain('unsafe-eval');
  expect(h['strict-transport-security']).toBe('max-age=31536000');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('same-origin');
  expect(h['permissions-policy']).toContain('camera=()');
  expect(h['x-powered-by']).toBeUndefined();

  const html = await res.text();
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.filter((s) => !s.includes(`nonce="${String(nonce)}"`))).toEqual([]);

  const again = await request.get('/pribadi/beranda');
  expect(again.headers()['content-security-policy']).not.toContain(String(nonce));
});

test('GET /api/health: 200, no-store, tanpa rahasia', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-store');
  const body = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(['sha', 'status']);
  expect(body.status).toBe('ok');
});

test('manifest PWA dapat dibaca dan ikonnya ada', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  const m = (await res.json()) as {
    name: string;
    start_url: string;
    display: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(m.name).toBe('DompetKu');
  expect(m.display).toBe('standalone');
  for (const size of ['192x192', '512x512']) {
    expect(m.icons.some((i) => i.sizes === size)).toBe(true);
  }
  expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of m.icons) {
    expect((await request.get(icon.src)).status(), icon.src).toBe(200);
  }
});

test('tidak ada pelanggaran CSP di semua rute', async ({ page }) => {
  const violations = await watchCsp(page);
  for (const route of ROUTES) {
    await page.goto(route.path);
    await page.waitForLoadState('networkidle');
    expect(await violations(), route.path).toEqual([]);
  }
});

test('tidak ada pelanggaran CSP saat sheet Catat dibuka dan tema diganti', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const violations = await watchCsp(page);
  await page.goto('/pribadi/beranda?theme=light&today=2026-10-17');
  await page
    .getByRole('navigation', { name: 'Tab utama' })
    .getByRole('button', { name: 'Catat' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // Kunci gulir Radix (react-remove-scroll) menyisipkan <style> saat runtime; harus bernonce.
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  expect(await violations()).toEqual([]);
});
