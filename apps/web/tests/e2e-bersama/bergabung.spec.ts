import { spaceOf } from '../e2e-auth/helpers';
import { adminQuery } from '../e2e-ledger/fixtures';
import { expect, test } from './fixtures';
import { PARTNER } from './global-setup';

/**
 * Onboarding Farida (S8-O1/O2, kriteria keluar S8 Task 10): proyek `bergabung` jalan sebelum
 * fixture `kanari` mengisi Pribadi, jadi Pribadi F di sini benar-benar baru. Tidak memakai
 * fixture `kanari` dan tidak menulis data.
 */

test.describe.configure({ mode: 'serial' });

test('Pribadi F baru: checklist 3 langkah tanpa Undang Farida (S8-O1)', async ({
  partnerPage: page,
}) => {
  // Kontrol: Pribadi F memang kosong (tanpa dompet dan entri).
  const { sid } = await spaceOf(PARTNER, 'personal');
  const [counts] = await adminQuery<{ accounts: string; entries: string }>(
    `select (select count(*) from app.accounts where space_id = $1)::text as accounts,
              (select count(*) from app.entries where space_id = $1)::text as entries`,
    [sid],
  );
  expect(counts).toEqual({ accounts: '0', entries: '0' });

  await page.goto('/pribadi/beranda');
  await expect(page).toHaveURL(/\/pribadi\/beranda$/);
  const main = page.getByRole('main');
  const checklist = main.getByRole('region', { name: 'Mulai dari sini' });
  await expect(checklist).toContainText('1 dari 3 selesai');
  const steps = checklist.getByRole('list', { name: 'Mulai dari sini' }).getByRole('listitem');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText('Akun aman');
  await expect(steps.nth(1)).toContainText('Tambah dompet sehari-hari');
  await expect(steps.nth(2)).toContainText('Catat satu pengeluaran');
  // Tanpa langkah undang, tanpa langkah pengganti, tanpa pengantar Bersama, tanpa angka palsu.
  await expect(main.getByText(/Undang|belum bergabung|kalian bagi/)).toHaveCount(0);
  await expect(
    main.getByText(
      'Tambahkan dompet operasional untuk melihat berapa yang aman dipakai bulan ini.',
    ),
  ).toBeVisible();
  await expect(
    main.getByText('Belum ada transaksi. Catatan pertamamu akan muncul di sini.'),
  ).toBeVisible();
});

test('Bersama F tanpa B1; pengantar checklist dengan nama anggota lain (S8-O2)', async ({
  page,
  partnerPage,
}) => {
  for (const [p, other] of [
    [partnerPage, 'Novanda'],
    [page, 'Farida'],
  ] as const) {
    await p.goto('/bersama/beranda');
    await expect(p).toHaveURL(/\/bersama\/beranda$/);
    const main = p.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Beranda' }).first()).toBeVisible();
    // B1 hilang untuk kedua anggota: tanpa kartu ajakan dan tanpa salinan solo.
    await expect(main.getByText(/belum bergabung|Undang|Ruang untuk keuangan bersama/)).toHaveCount(
      0,
    );
    const checklist = main.getByRole('region', { name: 'Mulai dari sini' });
    await expect(checklist).toContainText(
      `Pengeluaran yang kalian bagi. Kamu dan ${other} sama-sama bisa mencatat dan mengubah di sini.`,
    );
  }
  // Layar F tidak menyebut F sebagai orang ketiga.
  await expect(partnerPage.getByRole('main')).not.toContainText('Farida');
});

test('N: Pribadi tanpa langkah Undang, /undang Diterima dan undangan baru ditutup', async ({
  page,
}) => {
  await page.goto('/pribadi/beranda');
  const checklist = page.getByRole('main').getByRole('region', { name: 'Mulai dari sini' });
  await expect(checklist).toContainText('1 dari 3 selesai');
  await expect(page.getByRole('main').getByText(/Undang/)).toHaveCount(0);

  await page.goto('/undang');
  await expect(page.getByText('Ruang Bersama sudah berisi dua orang.')).toBeVisible();
  await expect(page.getByText('Diterima')).toBeVisible();
  // Undangan ketiga tidak bisa dimulai: formulir tidak dirender (penolakan server di e2e:auth).
  await expect(page.getByLabel('Email pasangan')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Kirim undangan' })).toHaveCount(0);
});
