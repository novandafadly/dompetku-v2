import { expect, test, type Locator } from '@playwright/test';

/**
 * Utang tata letak S6 (Task 14, S7), lewat bingkai galeri `/dev/ui#kategori` (komponen layar nyata):
 * nama dompet 40 karakter di daftar Dompet ≤ 2 baris, dan keterangan riwayat dompet dengan nominal
 * `Rp 12.345.678.900` (nominal utuh, keterangan ellipsis satu baris dengan `title`) di 320 px.
 * Galat S6-C2 mode keyboard dibuktikan di `catat-status.spec.ts`.
 */

const SHOTS = '/tmp/claude-0/sdd/shots14';

test.use({ viewport: { width: 320, height: 640 } });

async function lines(el: Locator): Promise<number> {
  return el.evaluate((n) => {
    const lh = parseFloat(getComputedStyle(n).lineHeight);
    return Math.round(n.getBoundingClientRect().height / lh);
  });
}

test('nama dompet 40 karakter di daftar Dompet: paling banyak 2 baris di 320 px', async ({
  page,
}) => {
  await page.goto('/dev/ui#kategori');
  const frame = page.locator('[data-frame="d-nama-panjang"]');
  const name = frame.getByText('Tabungan Pendidikan Anak Pertama Nova 40', { exact: true });
  await name.scrollIntoViewIfNeeded();
  expect(await lines(name)).toBeLessThanOrEqual(2);
  const row = frame.getByRole('link', { name: /Nova 40/ });
  const money = row.locator('.num');
  // Saldo utuh, tidak keluar dari baris.
  const [rb, mb] = await Promise.all([row.boundingBox(), money.boundingBox()]);
  expect((mb?.x ?? 0) + (mb?.width ?? 0)).toBeLessThanOrEqual((rb?.x ?? 0) + (rb?.width ?? 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await frame.screenshot({ path: `${SHOTS}/dompet-nama-40-320.png` });
});

test('riwayat dompet: nominal Rp 12.345.678.900 utuh, keterangan ellipsis satu baris dengan title', async ({
  page,
}) => {
  await page.goto('/dev/ui#kategori');
  const frame = page.locator('[data-frame="d-riwayat"]');
  const row = frame.getByRole('link', { name: /Belanja bulanan/ });
  await row.scrollIntoViewIfNeeded();
  const label = row.getByText('Belanja bulanan dengan deskripsi yang sangat panjang sekali', {
    exact: true,
  });
  await expect(label).toHaveAttribute(
    'title',
    'Belanja bulanan dengan deskripsi yang sangat panjang sekali',
  );
  expect(await lines(label)).toBe(1);
  expect(await label.evaluate((n) => getComputedStyle(n).textOverflow)).toBe('ellipsis');
  // Nominal tidak terpotong: lebar isi = lebar tampak, dan ada di dalam baris.
  const money = row.locator('.num');
  await expect(money).toContainText('12.345.678.900');
  expect(await money.evaluate((n) => n.scrollWidth <= n.clientWidth + 0.5)).toBe(true);
  const [rb, mb] = await Promise.all([row.boundingBox(), money.boundingBox()]);
  expect((mb?.x ?? 0) + (mb?.width ?? 0)).toBeLessThanOrEqual((rb?.x ?? 0) + (rb?.width ?? 0));
  // Keterangan masih punya lebar terbaca (bukan 0 px) di samping nominal.
  const lb = await label.boundingBox();
  expect(lb?.width ?? 0).toBeGreaterThanOrEqual(120);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await frame.screenshot({ path: `${SHOTS}/riwayat-nominal-panjang-320.png` });
});
