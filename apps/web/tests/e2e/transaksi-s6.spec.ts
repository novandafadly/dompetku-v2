import { expect, test } from '@playwright/test';
import { expectNoSeriousViolations, WCAG_TAGS } from './axe';

/**
 * Keadaan Transaksi mode nyata lewat bingkai galeri `/dev/ui#transaksi-s6` (komponen page
 * nyata di atas VM statis, tanpa store demo/server): daftar, kosong pertama kali, kosong karena
 * bulan, gagal muat. axe serious/critical = 0 di terang dan gelap, 320/390/1280, tanpa gulir
 * horizontal (termasuk Rp 12.345.678.900). Mode nyata sungguhan diuji di e2e auth.
 */

for (const theme of ['dark', 'light'] as const) {
  for (const width of [320, 390, 1280]) {
    test(`transaksi nyata ${theme} ${String(width)}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/ui?theme=${theme}#transaksi-s6`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const section = page.locator('#transaksi-s6');
      const frame = (id: string) => section.locator(`[data-frame="${id}"]`);

      const daftar = frame('t-daftar');
      await expect(daftar.getByRole('listitem')).toHaveCount(3);
      await expect(daftar.getByRole('link', { name: 'Sampah' })).toHaveAttribute(
        'href',
        '/pribadi/sampah',
      );
      for (const link of await daftar.getByRole('listitem').getByRole('link').all()) {
        const box = await link.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }

      const pertama = frame('t-kosong-pertama');
      await expect(pertama.getByText('Belum ada transaksi di Bersama.')).toBeVisible();
      const catat = pertama.getByRole('button', { name: 'Catat' });
      await expect(catat).toBeVisible();
      await expect(catat).toHaveCSS('min-height', '48px');

      await expect(
        frame('t-kosong-bulan').getByText('Belum ada transaksi di September.'),
      ).toBeVisible();
      await expect(frame('t-kosong-bulan').getByRole('button', { name: 'Catat' })).toHaveCount(0);

      const gagal = frame('t-gagal').getByRole('alert');
      await expect(gagal).toContainText('Transaksi belum bisa dimuat.');
      await expect(gagal).toContainText('Periksa koneksi lalu coba lagi.');
      await expect(gagal.getByRole('button', { name: 'Coba lagi' })).toBeVisible();

      await expectNoSeriousViolations(page, { tags: WCAG_TAGS, include: '#transaksi-s6' });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      if (process.env.SCREENS_REAL) {
        for (const id of ['t-daftar', 't-kosong-pertama', 't-kosong-bulan', 't-gagal']) {
          await frame(id).screenshot({
            path: `test-results/screens-real/galeri-${id}-${theme}-${String(width)}.png`,
            animations: 'disabled',
          });
        }
      }
    });
  }
}
