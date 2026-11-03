import { expect, test } from '@playwright/test';
import { expectNoSeriousViolations, WCAG_TAGS } from './axe';

/**
 * S6-B1 "Tidak ada pengeluaran hari ini" dan kartu utama mode nyata lewat bingkai galeri
 * `/dev/ui#beranda-s6` (VM statis, tanpa store demo/server): axe serious/critical = 0 di terang
 * dan gelap, 320/390/1280, tanpa gulir horizontal (termasuk Rp −12.345.678.900).
 * Mode nyata sungguhan diuji di e2e auth (`pnpm e2e:auth`).
 */

for (const theme of ['dark', 'light'] as const) {
  for (const width of [320, 390, 1280]) {
    test(`beranda S6-B1 ${theme} ${String(width)}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/ui?theme=${theme}#beranda-s6`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const section = page.locator('#beranda-s6');
      const frame = (id: string) => section.locator(`[data-frame="${id}"]`);
      const label = 'Tidak ada pengeluaran hari ini';

      // Sukses: tombol diganti baris status yang menerima fokus.
      const idle = frame('b1-idle').getByRole('button', { name: label });
      await expect(idle).toHaveCSS('min-height', '44px');
      await idle.click();
      const status = frame('b1-idle').getByRole('status');
      await expect(status).toHaveText('Hari ini tercatat tanpa pengeluaran.');
      await expect(status).toBeFocused();

      // Menunggu server: aria-busy, fokus tetap di tombol (bukan atribut disabled).
      const busy = frame('b1-busy').getByRole('button', { name: label });
      await busy.click();
      await expect(busy).toHaveAttribute('aria-busy', 'true');
      await expect(busy).toBeFocused();

      // Gagal: galat role=alert, tombol tetap.
      await frame('b1-fail').getByRole('button', { name: label }).click();
      await expect(frame('b1-fail').getByRole('alert')).toHaveText(
        'Belum bisa ditandai. Periksa koneksi lalu coba lagi.',
      );

      await expect(frame('b1-done').getByRole('status')).toBeVisible();
      await expect(frame('kartu-negatif').getByTestId('hero-amount')).toHaveClass(/text-danger/);

      await expectNoSeriousViolations(page, { tags: WCAG_TAGS, include: '#beranda-s6' });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      if (process.env.SCREENS_REAL) {
        await section.screenshot({
          path: `test-results/screens-real/galeri-b1-${theme}-${String(width)}.png`,
          animations: 'disabled',
        });
      }
    });
  }
}
