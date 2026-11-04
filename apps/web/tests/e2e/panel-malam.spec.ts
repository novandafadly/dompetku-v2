import { expect, test } from '@playwright/test';
import { expectNoSeriousViolations, WCAG_TAGS } from './axe';

const q = 'today=2026-10-17';

test.describe('Beranda memuat dan galat (?state)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('B4: teks Memuat… terlihat dengan role=status, kerangka tanpa denyut', async ({ page }) => {
    await page.goto(`/pribadi/beranda?state=loading&${q}`);
    const status = page.getByRole('status').filter({ hasText: 'Memuat…' });
    await expect(status).toBeVisible();
    const skeletons = page.locator('[data-skeleton]');
    expect(await skeletons.count()).toBeGreaterThan(4);
    expect(await skeletons.first().evaluate((el) => getComputedStyle(el).animationName)).toBe(
      'none',
    );
    await expect(page.getByTestId('hero-amount')).toHaveCount(0);
  });

  test('B5: sebab + Coba lagi memuat ulang, Catat tetap bisa', async ({ page }) => {
    await page.goto(`/pribadi/beranda?state=error&${q}`);
    const alert = page.getByRole('alert').filter({ hasText: 'Beranda belum bisa dimuat' });
    await expect(alert.getByRole('heading', { name: 'Beranda belum bisa dimuat' })).toBeVisible();
    await expect(alert).toContainText('Catatan yang sudah tersimpan tidak hilang.');
    // Klik sebelum hidrasi tidak membuka sheet: ulangi klik sampai dialog muncul.
    const dialog = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    await expect(async () => {
      await alert.getByRole('button', { name: 'Catat tetap bisa' }).click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    await page.keyboard.press('Escape');
    await alert.getByRole('button', { name: 'Coba lagi' }).click();
    await expect(page.getByTestId('hero-amount')).toBeVisible();
    // Tautan berikutnya tidak membawa ?state lagi.
    const dompet = page
      .getByRole('navigation', { name: 'Tab utama' })
      .getByRole('link', { name: 'Dompet' });
    expect(await dompet.getAttribute('href')).not.toContain('state=');
  });

  for (const theme of ['dark', 'light'] as const) {
    for (const state of ['loading', 'error'] as const) {
      test(`axe ${state} ${theme}`, async ({ page }) => {
        await page.goto(`/pribadi/beranda?state=${state}&${q}&theme=${theme}`);
        await page.waitForLoadState('networkidle');
        await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      });
    }
  }

  test('T4: Transaksi memuat', async ({ page }) => {
    await page.goto(`/pribadi/transaksi?state=loading&${q}`);
    await expect(
      page.getByRole('status').filter({ hasText: 'Memuat transaksi Oktober…' }),
    ).toBeVisible();
  });
});

test.describe('AlertDialog Batalkan', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('fokus awal di Kembali; Kembali menutup tanpa membatalkan', async ({ page }) => {
    await page.goto(`/pribadi/transaksi?${q}`);
    await page.getByRole('main').getByRole('listitem').first().getByRole('link').click();
    await page.getByRole('main').getByRole('button', { name: 'Batalkan transaksi' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Batalkan transaksi ini?' });
    await expect(dialog.getByRole('button', { name: 'Kembali' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('main').getByRole('button', { name: 'Batalkan transaksi' }),
    ).toBeFocused();
    await expect(page.getByRole('main').getByText('Transaksi ini sudah dibatalkan.')).toHaveCount(
      0,
    );
  });
});

test.describe('Catat: judul = pemilih jenis', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('menu jenis dengan keyboard; Escape menutup menu saja', async ({ page }) => {
    await page.goto(`/pribadi/beranda?${q}`);
    await page
      .getByRole('navigation', { name: 'Tab utama' })
      .getByRole('button', { name: 'Catat' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    // Tunggu kode sheet sebenarnya (bukan placeholder) termuat.
    await expect(sheet.getByRole('radiogroup', { name: 'Kategori' })).toBeVisible({
      timeout: 15_000,
    });
    const title = sheet.getByRole('button', { name: 'Pengeluaran · Pribadi' });
    await expect(title).toHaveAttribute('aria-haspopup', 'menu');
    await expect(title).toHaveAttribute('aria-expanded', 'false');
    await title.focus();
    await page.keyboard.press('Enter');
    const menu = sheet.getByRole('menu', { name: 'Jenis transaksi' });
    await expect(menu.getByRole('menuitemradio')).toHaveText([
      'Pengeluaran',
      'Pemasukan',
      'Transfer',
    ]);
    await expect(menu.getByRole('menuitemradio', { name: 'Pengeluaran' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(sheet).toBeVisible();
    await expect(title).toBeFocused();

    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const income = page.getByRole('dialog', { name: 'Pemasukan · Pribadi' });
    await expect(income).toBeVisible();
    await expect(income.getByRole('button', { name: 'Pemasukan · Pribadi' })).toBeFocused();
    await expect(income.getByLabel('Ke dompet')).toBeVisible();
  });

  test('chip kategori dua baris, tidak terpilih otomatis; Simpan nonaktif dengan alasan', async ({
    page,
  }) => {
    await page.goto(`/pribadi/beranda?${q}`);
    await page
      .getByRole('navigation', { name: 'Tab utama' })
      .getByRole('button', { name: 'Catat' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    // Tunggu kode sheet sebenarnya (bukan placeholder) termuat.
    await expect(sheet.getByRole('radiogroup', { name: 'Kategori' })).toBeVisible({
      timeout: 15_000,
    });
    const group = sheet.getByRole('radiogroup', { name: 'Kategori' });
    await expect(group.getByRole('radio').first()).toBeVisible();
    await expect(group.getByRole('radio', { checked: true })).toHaveCount(0);
    const tops = await group
      .getByRole('radio')
      .evaluateAll((els) => [
        ...new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))),
      ]);
    expect(tops).toHaveLength(2);
    await page.keyboard.type('22000');
    await expect(sheet.getByText('Pilih kategori untuk menyimpan')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Simpan' })).toBeDisabled();
  });
});

test.describe('tab bar di bawah 360 px', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('Catat jadi ubin ikon 48×48 berlabel; judul ruang hanya untuk pembaca layar', async ({
    page,
  }) => {
    await page.goto(`/pribadi/beranda?${q}`);
    const catat = page
      .getByRole('navigation', { name: 'Tab utama' })
      .getByRole('button', { name: 'Catat' });
    await expect(catat).toHaveAttribute('aria-keyshortcuts', 'c');
    const tile = catat.locator('span').first();
    const box = await tile.boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(48);
    expect(Math.round(box?.height ?? 0)).toBe(48);
    const label = await catat.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { height: r.height, text: el.textContent.trim() };
    });
    expect(label.text).toBe('Catat');
    expect(label.height).toBeGreaterThan(48);
    const title = page.getByRole('banner').getByText('Pribadi', { exact: true }).first();
    expect(await title.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });

  test('di 390 px Catat tetap tombol isi 48 px dengan teks di samping ikon', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/pribadi/beranda?${q}`);
    const catat = page
      .getByRole('navigation', { name: 'Tab utama' })
      .getByRole('button', { name: 'Catat' });
    expect(Math.round((await catat.boundingBox())?.height ?? 0)).toBe(48);
    await expect(catat).toHaveCSS('background-color', 'rgb(196, 238, 106)');
  });
});

test.describe('Toast', () => {
  // Tanpa animasi masuk agar posisi yang diukur adalah posisi akhir.
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

  test('dibalik dari tema, 92 px dari bawah, ikon centang', async ({ page }) => {
    await page.goto(`/pribadi/transaksi?${q}`);
    await page.getByRole('main').getByRole('listitem').first().getByRole('link').click();
    await page.getByRole('main').getByRole('button', { name: 'Ubah' }).click();
    const toast = page
      .getByRole('region', { name: /Notifikasi/ })
      .getByRole('listitem')
      .filter({ hasText: 'Segera di M1' });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCSS('background-color', 'rgb(237, 241, 238)');
    const box = await toast.boundingBox();
    expect(Math.round(844 - (box?.y ?? 0) - (box?.height ?? 0))).toBeGreaterThanOrEqual(92);
    expect(Math.round(box?.x ?? 0)).toBe(12);
  });
});
