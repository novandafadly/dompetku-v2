import { createSeed, entryTitle, groupByDay } from '@dompetku/demo-data';
import { addDays, formatRupiah, fullDateLabel } from '@dompetku/domain';
import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousViolations, WCAG_TAGS } from './axe';

/**
 * Sampah mode prototipe (S6-S1): batalkan dari Detail → Menu → Sampah → Pulihkan → kembali di
 * Transaksi, keadaan kosong/memuat, dan axe terang/gelap 320/390/1280. Keadaan yang tidak bisa
 * dicapai dengan data demo (nominal panjang, saldo, lewat 90 hari) diuji lewat bingkai galeri
 * `/dev/ui#sampah-s6` (komponen yang sama dengan Sampah nyata).
 */

const TODAY = '2026-10-17';
const q = `today=${TODAY}`;
const full = createSeed({ today: TODAY, variant: 'full' });
// Pengeluaran Pribadi teratas di daftar bulan ini (seperti transaksi.spec.ts): tampil di Transaksi.
const victim = groupByDay(
  full.entries.filter(
    (e) =>
      e.ruang === 'pribadi' &&
      e.voidedAt === undefined &&
      e.occurredOn.startsWith(TODAY.slice(0, 7)),
  ),
  TODAY,
)[0]?.items[0];
if (victim?.kind !== 'expense') throw new Error('seed tanpa pengeluaran Pribadi bulan ini');
const victimId = victim.id;
const title = entryTitle(full, victim);
const amount = formatRupiah(victim.amount);
const purge = `Terhapus permanen ${fullDateLabel(addDays(TODAY, 90))}`;
const EMPTY = 'Sampah kosong. Transaksi yang dibatalkan bisa dipulihkan di sini selama 90 hari.';

const toasts = (page: Page) => page.getByRole('region', { name: /Notifikasi/ });

/** Batalkan entri dari Detail (klien, store demo tetap hidup), lalu buka Sampah lewat Menu. */
async function voidThenOpenSampah(page: Page) {
  await page.goto(`/pribadi/transaksi/${victimId}?${q}`);
  await page.getByRole('main').getByRole('button', { name: 'Batalkan transaksi' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Batalkan transaksi' }).click();
  await expect(page).toHaveURL(new RegExp(`/pribadi/transaksi\\?${q}$`));
  await page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await menu.getByRole('link', { name: 'Sampah' }).click();
  await expect(page).toHaveURL(new RegExp(`/pribadi/sampah\\?${q}$`));
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('Sampah prototipe', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Menu: Sampah aktif, butir lain tetap Segera', async ({ page }) => {
    await page.goto(`/pribadi/beranda?${q}`);
    await page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    const sampah = menu.getByRole('link', { name: 'Sampah' });
    await expect(sampah).toHaveAttribute('href', `/pribadi/sampah?${q}`);
    await expect(sampah).not.toContainText('Segera');
    for (const name of ['Trip', 'Kategori', 'Kontak', 'Export', 'Analisis', 'Pengaturan']) {
      await expect(menu.getByRole('button', { name: new RegExp(name) })).toContainText('Segera');
    }
  });

  test('batalkan → Menu → Sampah → Pulihkan → entri kembali di Transaksi', async ({ page }) => {
    await voidThenOpenSampah(page);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'Sampah · Pribadi' })).toBeVisible();
    const row = main.getByRole('listitem').filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(purge);
    await expect(row).toContainText('Dibatalkan Hari ini');
    // Baris bukan tautan (R1): hanya tombol Pulihkan yang interaktif.
    await expect(row.getByRole('link')).toHaveCount(0);
    const restore = row.getByRole('button', { name: `Pulihkan ${title}` });
    const box = await restore.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await restore.click();
    await expect(toasts(page).getByText(`Dipulihkan di Pribadi · ${amount}`)).toBeVisible();
    await expect(main.getByText(EMPTY)).toBeVisible();
    await expect(main.getByRole('heading', { level: 1 })).toBeFocused();

    await main.getByRole('link', { name: 'Transaksi' }).click();
    await expect(page).toHaveURL(new RegExp(`/pribadi/transaksi\\?${q}$`));
    await expect(page.locator(`a[href*="/transaksi/${victimId}?"]`)).toHaveCount(1);
  });

  test('Sampah kosong menampilkan salinan S6-S1', async ({ page }) => {
    await page.goto(`/pribadi/sampah?${q}`);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'Sampah · Pribadi' })).toBeVisible();
    await expect(main.getByText(EMPTY)).toBeVisible();
    await expect(main.getByRole('listitem')).toHaveCount(0);
    await expect(main.getByRole('link', { name: 'Transaksi' })).toHaveAttribute(
      'href',
      `/pribadi/transaksi?${q}`,
    );
  });

  test('?state=loading menampilkan Memuat Sampah…', async ({ page }) => {
    await page.goto(`/pribadi/sampah?${q}&state=loading`);
    await expect(page.getByRole('main').getByRole('status')).toHaveText('Memuat Sampah…');
  });

  test('Sampah satu ruang: Bersama tidak melihat entri batal Pribadi', async ({ page }) => {
    await voidThenOpenSampah(page);
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(1);
    // Pindah ruang (navigasi klien, store demo tetap hidup) lalu Menu → Sampah Bersama.
    await page.getByRole('banner').getByRole('link', { name: 'Bersama' }).click();
    await expect(page).toHaveURL(new RegExp(`/bersama/beranda\\?${q}$`));
    await page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Sampah' }).click();
    await expect(page).toHaveURL(new RegExp(`/bersama/sampah\\?${q}$`));
    await expect(page.getByRole('main').getByText(EMPTY)).toBeVisible();
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
      'Sampah · Bersama',
    );
  });

  test('tautan Sampah di bawah daftar Transaksi sekarang hidup', async ({ page }) => {
    await page.goto(`/pribadi/transaksi?${q}`);
    await page.getByRole('main').getByRole('link', { name: 'Sampah' }).click();
    await expect(page).toHaveURL(new RegExp(`/pribadi/sampah\\?${q}$`));
    await expect(page.getByRole('main').getByText(EMPTY)).toBeVisible();
  });
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 1280]) {
    test(`axe Sampah prototipe ${theme} ${String(width)}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const themed = `theme=${theme}`;
      await page.goto(`/pribadi/sampah?${q}&${themed}`);
      await expect(page.getByRole('main').getByText(EMPTY)).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });

      // Dengan satu baris: lewat Detail → Menu → Sampah, query (termasuk tema) ikut terbawa.
      await page.goto(`/pribadi/transaksi/${victimId}?${q}&${themed}`);
      await page.getByRole('main').getByRole('button', { name: 'Batalkan transaksi' }).click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Batalkan transaksi' })
        .click();
      await page.getByRole('main').getByRole('link', { name: 'Sampah' }).click();
      await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(1);
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}

/** Bingkai galeri S6-S1: daftar nominal panjang, kosong, memuat, gagal muat, lewat 90 hari, saldo. */
for (const theme of ['dark', 'light'] as const) {
  for (const width of [320, 390, 1280]) {
    test(`galeri Sampah ${theme} ${String(width)}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/ui?theme=${theme}#sampah-s6`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const section = page.locator('#sampah-s6');
      const frame = (id: string) => section.locator(`[data-frame="${id}"]`);

      const daftar = frame('s-daftar');
      await expect(daftar.getByRole('listitem')).toHaveCount(3);
      await expect(daftar.getByText(/^Terhapus permanen /)).toHaveCount(3);
      for (const button of await daftar.getByRole('button').all()) {
        const box = await button.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      }
      await expect(frame('s-kosong').getByText(EMPTY)).toBeVisible();
      await expect(frame('s-memuat').getByRole('status')).toHaveText('Memuat Sampah…');
      const gagal = frame('s-gagal').getByRole('alert');
      await expect(gagal).toContainText('Sampah belum bisa dimuat.');
      await expect(gagal).toContainText('Periksa koneksi lalu coba lagi.');
      await expect(gagal.getByRole('button', { name: 'Coba lagi' })).toBeVisible();

      // Lewat 90 hari saat ditekan: teks sebaris di tempat tombol, baris tetap.
      const lewat = frame('s-lewat');
      await lewat.getByRole('button', { name: /^Pulihkan/ }).click();
      await expect(
        lewat.getByText('Lewat 90 hari, transaksi ini tidak bisa dipulihkan lagi.'),
      ).toBeVisible();
      await expect(lewat.getByRole('listitem')).toHaveCount(1);
      await expect(lewat.getByRole('button')).toHaveCount(0);

      // Saldo tidak cukup: peringatan inline, lalu Tetap pulihkan.
      const saldo = frame('s-saldo');
      await saldo.getByRole('button', { name: /^Pulihkan/ }).click();
      await expect(saldo.getByText(/^Saldo BCA tinggal Rp\s20\.000\./)).toBeVisible();
      await expect(saldo.getByRole('button', { name: /^Tetap pulihkan/ })).toBeVisible();

      await expectNoSeriousViolations(page, { tags: WCAG_TAGS, include: '#sampah-s6' });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      if (process.env.SCREENS_REAL) {
        for (const id of ['s-daftar', 's-kosong', 's-memuat', 's-gagal', 's-lewat', 's-saldo']) {
          await frame(id).screenshot({
            path: `test-results/screens-sampah/galeri-${id}-${theme}-${String(width)}.png`,
            animations: 'disabled',
          });
        }
      }
    });
  }
}
