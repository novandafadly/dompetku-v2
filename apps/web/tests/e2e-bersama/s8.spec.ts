import { spaceOf } from '../e2e-auth/helpers';
import { adminQuery } from '../e2e-ledger/fixtures';
import { expect, test } from './fixtures';
import { PARTNER } from './global-setup';

// Kerangka harness dua user; Task 10 mengisi tes kriteria keluar S8.
test(
  'F bergabung: Pribadi F kosong, Bersama berisi dua anggota',
  { tag: [] }, // ID: Task 11
  async ({ page, partnerPage, kanari }) => {
    // Kontrol positif: F terautentikasi di Pribadi-nya dan melihat kanari F, bukan kanari N.
    await partnerPage.goto('/pribadi/dompet');
    await expect(partnerPage).toHaveURL(/\/pribadi\/dompet$/);
    await expect(partnerPage.getByText(kanari.f.wallet)).toBeVisible();
    await expect(partnerPage.getByText(kanari.n.wallet)).toHaveCount(0);
    await partnerPage.goto('/pribadi/transaksi');
    await expect(partnerPage.getByText(kanari.f.description)).toBeVisible();
    await expect(partnerPage.getByText(kanari.n.description)).toHaveCount(0);

    // Bersama: F tetap di rute itu (tidak dialihkan) dan DB mencatat dua anggota ruang yang sama.
    await partnerPage.goto('/bersama/beranda');
    await expect(partnerPage).toHaveURL(/\/bersama\/beranda$/);
    await expect(partnerPage.getByRole('heading', { name: 'Beranda' })).toBeVisible();
    await expect(partnerPage.getByRole('link', { name: /Undang Farida/ })).toHaveCount(0);
    const { sid } = await spaceOf(PARTNER, 'shared');
    const members = await adminQuery<{ n: string }>(
      'select count(*)::text as n from app.space_members where space_id = $1',
      [sid],
    );
    expect(members[0]?.n).toBe('2');
    await page.goto('/undang');
    await expect(page.getByText('Ruang Bersama sudah berisi dua orang.')).toBeVisible();
  },
);
