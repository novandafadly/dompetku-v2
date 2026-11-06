import { createSeed } from '@dompetku/demo-data';
import { expect, test } from '@playwright/test';
import { isDemoChunk, routeScripts } from './route-scripts';
import { TODAY } from './routes';

/**
 * Batas JS muat dingin per rute (docs/adr/0002-js-budget.md): baseline Next 16 + React 19
 * untuk rute kosong (131,9 kB) + 30 kB untuk kode aplikasi.
 */
const BUDGET_KB = 162;

// Detail transaksi (Task 16): pengeluaran Pribadi pertama di seed penuh, sama dengan routes.ts.
const detailId =
  createSeed({ today: TODAY, variant: 'full' }).entries.find(
    (e) => e.ruang === 'pribadi' && e.kind === 'expense' && e.voidedAt === undefined,
  )?.id ?? '';

for (const path of [
  '/pribadi/beranda',
  '/pribadi/transaksi',
  `/pribadi/transaksi/${detailId}`,
  '/pribadi/sampah',
  '/pribadi/dompet',
  // Riwayat dompet (S7 Task 12): dompet BCA di seed penuh.
  '/pribadi/dompet/acc-bca',
  // Aktivitas Bersama (S8 Task 7): rute demo ringan.
  '/bersama/aktivitas',
  // Rencana (S9 Task 10): prototipe tetap keadaan kosong; JS nyata diukur di e2e:ledger.
  '/pribadi/rencana',
]) {
  test(`JS muat dingin ${path} ≤ ${String(BUDGET_KB)} kB`, async ({ browser }) => {
    // Konteks baru = cache kosong.
    const context = await browser.newContext();
    const page = await context.newPage();
    const bodies: Promise<{ path: string; demo: boolean }>[] = [];
    page.on('response', (r) => {
      const p = new URL(r.url()).pathname;
      if (p.endsWith('.js')) bodies.push(r.text().then((b) => ({ path: p, demo: isDemoChunk(b) })));
    });
    const response = await page.goto(`${path}?seed=full&today=${TODAY}`);
    if (!response) throw new Error('tidak ada respons dokumen');
    const own = routeScripts(await response.text());
    await page.waitForLoadState('networkidle');
    // Chunk DemoProvider (route-scripts.ts) dihitung sebagai JS rute: hidrasi prototipe menunggunya.
    const demoChunks = (await Promise.all(bodies)).filter((b) => b.demo).map((b) => b.path);
    expect(demoChunks).toHaveLength(1);
    for (const p of demoChunks) own.add(p);
    const sizes = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((e): e is PerformanceResourceTiming => e instanceof PerformanceResourceTiming)
        .filter((e) => new URL(e.name).pathname.endsWith('.js'))
        .map((e) => ({ path: new URL(e.name).pathname, bytes: e.encodedBodySize })),
    );
    await context.close();

    const kB = (n: number) => n / 1024;
    const routeKb = kB(sizes.filter((s) => own.has(s.path)).reduce((a, s) => a + s.bytes, 0));
    const allKb = kB(sizes.reduce((a, s) => a + s.bytes, 0));
    test
      .info()
      .annotations.push(
        { type: 'js-route-kB', description: routeKb.toFixed(1) },
        { type: 'js-all-kB', description: allKb.toFixed(1) },
      );
    // Setiap skrip yang dirujuk HTML punya entri dan benar-benar terukur (bukan 0 karena cache/404).
    const measured = new Set(sizes.map((s) => s.path));
    expect([...own].filter((p) => !measured.has(p))).toEqual([]);
    expect(sizes.filter((s) => own.has(s.path)).every((s) => s.bytes > 0)).toBe(true);
    expect(routeKb).toBeGreaterThan(100);
    expect(routeKb).toBeLessThanOrEqual(BUDGET_KB);
  });
}
