import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousViolations, WCAG_TAGS } from './axe';

/**
 * Kategori (S6-K1/K2) dan Dompet nyata (daftar, kosong, riwayat, Tambah dompet) lewat bingkai galeri
 * `/dev/ui#kategori-s6` (VM statis, tanpa store demo/server): ukuran target, sheet/dialog terbuka,
 * axe serious/critical = 0 di terang dan gelap, 320/390/1280, tanpa gulir horizontal. Di prototipe
 * layar Kategori sendiri tidak ada (Menu tetap "Segera"); layar nyata diuji di `e2e:auth`.
 */

const TODAY = '2026-10-17';

test('prototipe: /pribadi/kategori tidak ada dan Kategori di Menu tetap Segera', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Status stream sudah 200 saat page melempar notFound (Suspense root); isinya halaman 404.
  await page.goto(`/pribadi/kategori?today=${TODAY}`);
  await expect(page.getByText('This page could not be found.')).toBeVisible();
  await page.goto(`/pribadi/beranda?today=${TODAY}`);
  await page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await expect(menu.getByRole('link', { name: 'Kategori' })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: /Kategori/ })).toContainText('Segera');
});

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const theme of ['dark', 'light'] as const) {
  for (const width of [320, 390, 1280]) {
    test(`galeri Kategori + Dompet nyata ${theme} ${String(width)}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/ui?theme=${theme}#kategori-s6`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const section = page.locator('#kategori-s6');
      const frame = (id: string) => section.locator(`[data-frame="${id}"]`);

      // S6-K1: baris = tombol ≥ 52, anak bersarang di bawah induknya, nama panjang membungkus.
      const daftar = frame('k-daftar');
      const rows = daftar.getByRole('button');
      await expect(rows).toHaveCount(6);
      for (const row of await rows.all()) {
        const box = await row.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(52);
      }
      const nested = daftar.getByRole('list', { name: 'Subkategori Belanja Dapur' });
      await expect(nested.getByRole('button')).toHaveCount(2);
      await expect(frame('k-pemasukan').getByRole('button')).toHaveCount(2);
      await expect(frame('k-kosong')).toContainText('Belum ada kategori pengeluaran di Pribadi.');
      await expect(
        frame('k-kosong').getByRole('button', { name: 'Tambah kategori' }),
      ).toBeVisible();

      // Dompet nyata: saldo panjang tidak memecah tata letak; Kantor tidak masuk kekayaan bersih.
      const dompet = frame('d-daftar');
      await expect(dompet.getByTestId('net-worth')).toContainText('12.349.753.900');
      await expect(dompet.getByText('Tidak masuk hitungan pribadi')).toBeVisible();
      await expect(frame('d-kosong')).toContainText('Belum ada dompet di Bersama.');
      await expect(frame('d-riwayat').getByTestId('wallet-balance')).toContainText(
        '12.345.678.900',
      );

      await expectNoSeriousViolations(page, { tags: WCAG_TAGS, include: '#kategori-s6' });
      await noHorizontalScroll(page);

      // S6-K1 sheet: ubin ikon 44, galat nama ganda inline + fokus ke Nama, Induk nonaktif bila punya anak.
      await frame('k-sheet').getByRole('button', { name: 'Tambah kategori' }).click();
      const sheet = page.getByRole('dialog', { name: /Tambah kategori/ });
      await expect(sheet.getByRole('textbox', { name: 'Nama' })).toBeFocused();
      for (const radio of await sheet.getByRole('radio').all()) {
        const box = await radio.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      }
      await sheet.getByRole('button', { name: 'Simpan kategori' }).click();
      await expect(sheet.getByText('Nama kategori wajib diisi.')).toBeVisible();
      await expect(sheet.getByRole('textbox', { name: 'Nama' })).toBeFocused();
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      await noHorizontalScroll(page);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await frame('k-sheet')
        .getByRole('button', { name: /^Ubah → galat nama ganda/ })
        .click();
      const ubah = page.getByRole('dialog', { name: /Ubah kategori/ });
      await ubah.getByRole('button', { name: 'Simpan kategori' }).click();
      await expect(
        ubah.getByText('Nama ini sudah dipakai kategori lain di Bersama.'),
      ).toBeVisible();
      await expect(ubah.getByRole('textbox', { name: 'Nama' })).toBeFocused();
      await expect(ubah.getByRole('button', { name: 'Arsipkan kategori' })).toBeVisible();
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      await page.keyboard.press('Escape');

      await frame('k-sheet')
        .getByRole('button', { name: /^Ubah \(punya anak/ })
        .click();
      const punyaAnak = page.getByRole('dialog', { name: /Ubah kategori/ });
      await expect(punyaAnak.getByRole('combobox', { name: 'Induk' })).toBeDisabled();
      await expect(punyaAnak.getByText(/Punya subkategori/)).toBeVisible();
      await page.keyboard.press('Escape');

      await frame('k-sheet')
        .getByRole('button', { name: /^Ubah → galat dua tingkat/ })
        .click();
      const dua = page.getByRole('dialog', { name: /Ubah kategori/ });
      await dua.getByRole('button', { name: 'Simpan kategori' }).click();
      await expect(dua.getByText('Kategori hanya bisa dua tingkat.')).toBeVisible();
      await expect(dua.getByRole('combobox', { name: 'Induk' })).toBeFocused();
      await page.keyboard.press('Escape');

      await frame('k-sheet')
        .getByRole('button', { name: /^Tambah → galat jaringan/ })
        .click();
      const jaringan = page.getByRole('dialog', { name: /Tambah kategori/ });
      await jaringan.getByRole('textbox', { name: 'Nama' }).fill('Bonus');
      await jaringan.getByRole('button', { name: 'Simpan kategori' }).click();
      await expect(jaringan.getByRole('alert')).toContainText('Koneksi terputus saat mengirim');
      await expect(jaringan.getByRole('button', { name: 'Coba lagi' })).toBeVisible();
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      await page.keyboard.press('Escape');

      // S6-K2: fokus awal di Kembali; salinan menyebut subkategori.
      await frame('k-arsip')
        .getByRole('button', { name: /dengan 2 subkategori/ })
        .click();
      const dialog = page.getByRole('alertdialog', { name: 'Arsipkan Belanja Dapur?' });
      await expect(dialog).toContainText(
        'Belanja Dapur tidak ditawarkan lagi di Catat Pribadi. Transaksi lama tetap memakai kategori ini. 2 subkategori ikut diarsipkan.',
      );
      await expect(dialog.getByRole('button', { name: 'Kembali' })).toBeFocused();
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      await dialog.getByRole('button', { name: 'Kembali' }).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);

      // Tambah dompet (bersama dengan prototipe): batas nama 40, galat nama ganda.
      await frame('d-tambah').getByRole('button', { name: 'Tambah dompet' }).click();
      const wallet = page.getByRole('dialog', { name: /Tambah dompet/ });
      await expect(wallet.getByRole('textbox', { name: 'Nama' })).toHaveAttribute(
        'maxlength',
        '40',
      );
      await wallet.getByRole('textbox', { name: 'Nama' }).fill('bca');
      await wallet.getByRole('radio', { name: 'Operasional' }).click();
      await wallet.getByRole('button', { name: 'Simpan dompet' }).click();
      await expect(wallet.getByText('Dompet bernama BCA sudah ada di Pribadi.')).toBeVisible();
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      await noHorizontalScroll(page);
    });
  }
}
