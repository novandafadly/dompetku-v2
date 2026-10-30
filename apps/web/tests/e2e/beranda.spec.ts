import { createSeed, safeToSpend } from '@dompetku/demo-data';
import { formatRupiah } from '@dompetku/domain';
import { expect, test } from '@playwright/test';

const TODAY = '2026-10-17';
const q = `today=${TODAY}`;
const full = createSeed({ today: TODAY, variant: 'full' });

test.describe('Beranda Pribadi kosong', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('checklist, kalimat ajakan, tanpa Rp 0', async ({ page }) => {
    await page.goto(`/pribadi/beranda?seed=empty&${q}`);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Mulai dari sini' })).toBeVisible();
    const items = main.getByRole('list', { name: 'Mulai dari sini' }).getByRole('listitem');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText('Akun aman');
    await expect(items.nth(0)).toContainText('Selesai');
    await expect(items.nth(1)).toContainText('Tambah dompet sehari-hari');
    await expect(items.nth(1)).toContainText('Belum');
    await expect(items.nth(2)).toContainText('Catat satu pengeluaran');
    await expect(items.nth(3)).toContainText('Undang Farida');
    await expect(
      main.getByText(
        'Tambahkan dompet operasional untuk melihat berapa yang aman dipakai bulan ini.',
      ),
    ).toBeVisible();
    await expect(page.getByTestId('hero-amount')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain('Rp 0');
    expect(await page.locator('body').innerText()).not.toMatch(/Rp\s?0\b/);
  });

  test('Bersama kosong: tanpa Undang Farida, kalimat penjelas', async ({ page }) => {
    await page.goto(`/bersama/beranda?seed=empty&${q}`);
    const main = page.getByRole('main');
    await expect(main.getByText('Undang Farida')).toHaveCount(0);
    await expect(main.getByText('Buat dompet bersama')).toBeVisible();
    await expect(main.getByText(/Pengeluaran rumah tangga yang kalian bagi/)).toBeVisible();
  });
});

test.describe('Beranda Pribadi terisi', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('judul, hero, kolom rumus, per hari, bagian daftar', async ({ page }) => {
    const r = safeToSpend(full, 'pribadi', TODAY);
    await page.goto(`/pribadi/beranda?${q}`);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Aman dipakai sampai 31 Okt');
    await expect(page.getByTestId('hero-amount')).toContainText(formatRupiah(r.total));
    const table = main.getByRole('table');
    await expect(table.getByRole('row')).toHaveCount(4);
    for (const label of [
      'Saldo operasional',
      'Tagihan s.d. 31 Okt',
      'Sisa anggaran wajib',
      'Aman dipakai',
    ]) {
      await expect(table.getByRole('rowheader', { name: label })).toBeVisible();
    }
    const borderStyle = await table
      .locator('tfoot tr')
      .evaluate((el) => getComputedStyle(el).borderTopStyle);
    expect(borderStyle).toBe('double');
    await expect(
      main.getByText(`≈ ${formatRupiah(r.perDay)} per hari untuk 15 hari`),
    ).toBeVisible();

    const bills = main.getByRole('region', { name: 'Tagihan 7 hari' });
    await expect(bills.getByText('Cicilan ponsel')).toBeVisible();
    await expect(bills.getByText('Tagihan kartu kredit')).toBeVisible();
    const budgets = main.getByRole('region', { name: 'Anggaran hampir habis' });
    await expect(budgets.getByText('Langganan')).toBeVisible();
    await expect(budgets.getByText('85% terpakai')).toBeVisible();
    await expect(budgets.locator('svg')).toHaveCount(1);
    await expect(budgets.getByText('Makan Siang & Minum')).toHaveCount(0);
    const recent = main.getByRole('region', { name: 'Terakhir' });
    await expect(recent.getByRole('listitem')).toHaveCount(5);
    await expect(main.getByText(/kekayaan bersih/i)).toHaveCount(0);
    await expect(main.getByRole('region', { name: 'Aktivitas' })).toHaveCount(0);
  });

  test('Anggaran hampir habis hanya memuat pct >= 80 (Bersama)', async ({ page }) => {
    await page.goto(`/bersama/beranda?${q}`);
    const budgets = page.getByRole('region', { name: 'Anggaran hampir habis' });
    await expect(budgets.getByText('Makan di Luar')).toBeVisible();
    await expect(budgets.getByText('85% terpakai')).toBeVisible();
    await expect(budgets.getByText('100% terpakai')).toBeVisible();
    await expect(budgets.locator('svg')).toHaveCount(2);
    await expect(budgets.getByText('Belanja Dapur')).toHaveCount(0);
  });

  test('tagihan terlewat berlabel "Lewat N hari"', async ({ page }) => {
    await page.goto(`/bersama/beranda?${q}`);
    const bills = page.getByRole('region', { name: 'Tagihan 7 hari' });
    await expect(bills.getByText('Iuran kebersihan RT')).toBeVisible();
    await expect(bills.getByText('Lewat 3 hari')).toBeVisible();
  });
});

test.describe('Beranda Bersama', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('tidak memuat deskripsi pengeluaran Pribadi', async ({ page }) => {
    const own = full.entries.filter(
      (e) => e.ruang === 'pribadi' && e.kind === 'expense' && e.description !== undefined,
    );
    const bersamaText = new Set(
      full.entries.filter((e) => e.ruang === 'bersama').map((e) => e.description),
    );
    const secret = own.find((e) => !bersamaText.has(e.description))?.description;
    expect(secret).toBeDefined();
    await page.goto(`/bersama/beranda?${q}`);
    await expect(page.getByTestId('hero-amount')).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(secret ?? '');
  });

  test('aksen bata, judul bersama, feed Aktivitas dengan inisial', async ({ page }) => {
    const r = safeToSpend(full, 'bersama', TODAY);
    await page.goto(`/bersama/beranda?${q}`);
    const main = page.getByRole('main');
    const h1 = main.getByRole('heading', { level: 1 });
    await expect(h1).toHaveText('Aman dipakai bersama sampai 31 Okt');
    await expect(h1).toHaveCSS('color', 'rgb(163, 70, 30)');
    await expect(page.getByTestId('hero-amount')).toContainText(formatRupiah(r.total));
    const feed = main.getByRole('region', { name: 'Aktivitas' });
    const rows = feed.getByRole('listitem');
    await expect(rows).toHaveCount(5);
    const initials = await rows.locator('[data-initial]').allInnerTexts();
    expect(initials.every((t) => t === 'N' || t === 'F')).toBe(true);
    expect(await feed.innerText()).toMatch(/Novanda|Farida/);
  });
});

test.describe('Tidak ada pengeluaran hari ini', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('tombol hilang bila sudah ada pengeluaran hari ini', async ({ page }) => {
    await page.goto(`/pribadi/beranda?${q}`);
    await expect(page.getByRole('button', { name: 'Tidak ada pengeluaran hari ini' })).toHaveCount(
      0,
    );
  });

  test('klik mengganti tombol dengan teks dan bertahan antar tab', async ({ page }) => {
    await page.goto('/bersama/beranda?today=2026-10-19');
    const btn = page.getByRole('button', { name: 'Tidak ada pengeluaran hari ini' });
    await expect(btn).toBeVisible();
    expect((await btn.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await btn.click();
    await expect(btn).toHaveCount(0);
    await expect(page.getByText('Hari ini tercatat tanpa pengeluaran')).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Tab utama' })
      .getByRole('link', { name: 'Dompet' })
      .click();
    await page
      .getByRole('navigation', { name: 'Tab utama' })
      .getByRole('link', { name: 'Beranda' })
      .click();
    await expect(page.getByText('Hari ini tercatat tanpa pengeluaran')).toBeVisible();
  });
});

test.describe('Beranda 320', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const ruang of ['pribadi', 'bersama']) {
    test(`${ruang}: tanpa scroll horizontal`, async ({ page }) => {
      await page.goto(`/${ruang}/beranda?${q}`);
      await expect(page.getByTestId('hero-amount')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        320,
      );
    });
  }
});
