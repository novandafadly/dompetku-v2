import { randomUUID } from 'node:crypto';
import { expectNoSeriousViolations } from '../e2e/axe';
import { asUser, noHorizontalScroll, spaceOf } from '../e2e-auth/helpers';
import { expect, test } from './fixtures';
import { OWNER } from './global-setup';
import { expectRouteBudget } from './helpers';

/**
 * S18 mode nyata (e2e:ledger):
 * 1. Foto struk terenkripsi di Detail transaksi: unggah PNG sah → muat ulang → GET 200 image/png
 *    dengan nosniff + private, no-store → tolak SVG → hapus permanen → muat ulang bersih;
 * 2. Analisis AI (`/[ruang]/analisis`): ringkasan SQL + kuota 5 dari 5 + catatan jujur saat AI mati
 *    + 320px bebas gulir horizontal + axe 0 pelanggaran serius + budget JS <= 162 kB;
 * 3. PWA offline-baca & pembersihan cache saat logout: manifest + sw.js aktif + cache halaman ruang
 *    + mode offline tetap menampilkan Beranda + banner offline + Keluar mengosongkan cache pengguna.
 */
test.describe.configure({ mode: 'serial' });

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function wibToday(): string {
  const ms = Date.now() + 7 * 3_600_000;
  return new Date(ms).toISOString().slice(0, 10);
}

test('Foto struk terenkripsi di Detail transaksi: unggah, baca no-store/nosniff, tolak SVG, hapus permanen', async ({
  page,
}) => {
  const { uid, sid } = await spaceOf(OWNER, 'personal');
  const today = wibToday();

  const [accRow] = await asUser<{ r: { account_id: string } }>(
    uid,
    `select api.create_account($1, $2, $3, 'operasional', 'bank', $4::date, 2000000) as r`,
    [randomUUID(), sid, 'BCA S18', today],
  );
  const accId = accRow?.r.account_id;
  expect(accId).toBeTruthy();

  const [entryRow] = await asUser<{ r: { entry_id: string } }>(
    uid,
    `select api.create_entry(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_kind => 'expense', p_amount => 55000, p_description => 'Makan S18 Struk') as r`,
    [randomUUID(), sid, accId],
  );
  const entryId = entryRow?.r.entry_id;
  expect(entryId).toBeTruthy();

  await page.goto(`/pribadi/transaksi/${entryId ?? ''}`);
  const section = page.getByRole('region', { name: 'Foto struk' });
  await expect(section).toBeVisible();
  await expect(section).toContainText('0 dari 3');

  // Unggah PNG sah lewat input file tersembunyi.
  const fileInput = section.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: 'struk.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  });

  await expect(section).toContainText('1 dari 3');
  await expect(section.getByRole('link', { name: 'Struk 1', exact: true })).toBeVisible();

  // Muat ulang: lampiran tetap tampil dari DB.
  await page.reload();
  const reloadedSection = page.getByRole('region', { name: 'Foto struk' });
  await expect(reloadedSection).toContainText('1 dari 3');
  const linkHref = await reloadedSection
    .getByRole('link', { name: 'Struk 1', exact: true })
    .getAttribute('href');
  expect(linkHref).toMatch(/^\/pribadi\/transaksi\/[^/]+\/struk\/[^/]+$/);

  // Verifikasi header keamanan respons gambar dekripsi.
  const imgRes = await page.request.get(linkHref ?? '');
  expect(imgRes.status()).toBe(200);
  expect(imgRes.headers()['content-type']).toBe('image/png');
  expect(imgRes.headers()['x-content-type-options']).toBe('nosniff');
  expect(imgRes.headers()['cache-control']).toBe('private, no-store');
  expect(Buffer.from(await imgRes.body()).equals(TINY_PNG)).toBe(true);

  // Tolak SVG palsu dengan pesan galat Bahasa Indonesia.
  await reloadedSection.locator('input[type="file"]').setInputFiles({
    name: 'xss.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  });
  await expect(reloadedSection.getByRole('alert')).toContainText('Format berkas tidak didukung');

  // Hapus permanen (konfirmasi 2 langkah).
  await reloadedSection.getByRole('button', { name: 'Hapus foto struk 1' }).click();
  await expect(reloadedSection).toContainText('Hapus permanen foto ini?');
  await reloadedSection.getByRole('button', { name: 'Hapus', exact: true }).click();
  await expect(reloadedSection).toContainText('0 dari 3');

  // Muat ulang: foto benar-benar hilang & URL lama 404.
  await page.reload();
  await expect(page.getByRole('region', { name: 'Foto struk' })).toContainText('0 dari 3');
  const afterDelRes = await page.request.get(linkHref ?? '');
  expect(afterDelRes.status()).toBe(404);
});

test('Analisis AI: ringkasan SQL, kuota 5/5, 320px bebas gulir, axe, dan budget JS <= 162 kB', async ({
  page,
  browser,
  ownerState,
}) => {
  await expectRouteBudget(browser, ownerState, '/pribadi/analisis');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/pribadi/analisis');

  await expect(page.getByRole('heading', { name: 'Analisis AI', level: 1 })).toBeVisible();
  await expect(page.getByText('Kuota 5 dari 5 hari ini')).toBeVisible();
  await expect(page.getByText(/Analisis AI belum aktif di server ini/)).toBeVisible();

  // Pindah ke Periode lalu lewat tautan pemilih periode.
  await page.getByRole('link', { name: 'Periode lalu' }).click();
  await expect(page).toHaveURL(/\/pribadi\/analisis\?periode=lalu$/);
  await expect(page.getByRole('heading', { name: 'Analisis AI', level: 1 })).toBeVisible();

  await noHorizontalScroll(page);
  await expectNoSeriousViolations(page);
});

test('PWA offline-baca & pembersihan cache wajib saat Keluar', async ({ page, context }) => {
  // 1. Manifest & Service Worker tersedia dengan header tepat.
  const manifestRes = await page.request.get('/manifest.webmanifest');
  expect(manifestRes.status()).toBe(200);
  expect(await manifestRes.text()).toContain('DompetKu');

  const swRes = await page.request.get('/sw.js');
  expect(swRes.status()).toBe(200);
  expect(swRes.headers()['service-worker-allowed']).toBe('/');
  expect(swRes.headers()['cache-control']).toContain('no-cache');

  // 2. Kunjungi Beranda → SW mendaftar dan mengendalikan halaman.
  await page.goto('/pribadi/beranda');
  await expect(page.getByRole('main')).toBeVisible();

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  // Muat ulang sekali agar SW mengintersep navigasi dan mengisi cache dompetku-pages-v1.
  await page.reload();
  await expect(page.getByRole('main')).toBeVisible();

  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        const keys = await caches.keys();
        if (!keys.includes('dompetku-pages-v1')) return [];
        const c = await caches.open('dompetku-pages-v1');
        const reqs = await c.keys();
        return reqs.map((r) => new URL(r.url).pathname);
      });
    })
    .toContain('/pribadi/beranda');

  // Pastikan tidak ada URL /struk yang pernah masuk cache.
  const cachedPaths = await page.evaluate(async () => {
    const c = await caches.open('dompetku-pages-v1');
    return (await c.keys()).map((r) => new URL(r.url).pathname);
  });
  expect(cachedPaths.some((p) => p.includes('/struk'))).toBe(false);

  // 3. Mode offline: halaman Beranda tetap terbuka dari cache + banner offline muncul.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Sedang offline' })).toBeVisible();

  // 4. Kembali online lalu Keluar → seluruh cache dompetku-pages-* WAJIB kosong.
  await context.setOffline(false);
  await page.reload();
  await page.getByRole('button', { name: 'Menu', exact: true }).first().click();
  await page.getByRole('button', { name: 'Keluar', exact: true }).click();
  await expect(page).toHaveURL(/\/masuk\?status=keluar/);

  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        const keys = await caches.keys();
        return keys.filter((k) => k.startsWith('dompetku-pages-'));
      });
    })
    .toEqual([]);
});
