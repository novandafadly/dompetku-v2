import { expect, test } from './fixtures';

// Kerangka harness dua user; Task 10 mengisi tes kriteria keluar S8.
test(
  'F bergabung: Pribadi F kosong, Bersama berisi dua anggota',
  { tag: [] }, // ID: Task 11
  async ({ page, partnerPage, kanari }) => {
    await partnerPage.goto('/pribadi/dompet');
    await expect(partnerPage.getByText(kanari.n.wallet)).toHaveCount(0);
    await expect(partnerPage.getByText(kanari.n.description)).toHaveCount(0);
    // Bersama berisi dua anggota: N (sesi bawaan) melihat ruang penuh, F masuk ke Bersama.
    await page.goto('/undang');
    await expect(page.getByText('Ruang Bersama sudah berisi dua orang.')).toBeVisible();
    await partnerPage.goto('/bersama/beranda');
    await expect(partnerPage.getByRole('main')).toBeVisible();
    await expect(partnerPage.getByRole('link', { name: /Undang Farida/ })).toHaveCount(0);
  },
);
