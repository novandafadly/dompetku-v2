import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Gagal bila ada pelanggaran serious/critical; tiap temuan ditulis dengan penyeleksinya. */
export async function expectNoSeriousViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(serious).toEqual([]);
}
