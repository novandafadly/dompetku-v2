import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Tag WCAG yang diperiksa di seluruh rute M0a (WCAG 2.2 AA). */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

/** Gagal bila ada pelanggaran serious/critical; tiap temuan ditulis dengan penyeleksinya. */
export async function expectNoSeriousViolations(
  page: Page,
  opts: { tags?: string[]; include?: string } = {},
): Promise<void> {
  // Next 16 mengalirkan metadata (termasuk <title>) dalam batas Suspense terpisah dari isi
  // halaman. Setelah navigasi klien atau aksi server, isi bisa tampil lebih dulu sementara
  // <title> belum ter-commit; tunggu judulnya, lalu audit layar yang sudah lengkap.
  await expect(page).toHaveTitle(/\S/);
  let builder = new AxeBuilder({ page });
  if (opts.tags) builder = builder.withTags(opts.tags);
  if (opts.include) builder = builder.include(opts.include);
  const { violations } = await builder.analyze();
  const serious = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(serious).toEqual([]);
}
