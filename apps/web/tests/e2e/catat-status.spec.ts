import { expect, test, type Locator } from '@playwright/test';

/**
 * Keadaan simpan Catat (S6-C1…C6) lewat bingkai galeri `/dev/ui` (sumber palsu): store demo tidak
 * pernah gagal, jadi keadaan galat hanya bisa dipicu dari galeri.
 */

async function expectFullyVisible(locator: Locator, label: string) {
  const clipped = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    let top = 0;
    let left = 0;
    let bottom = window.innerHeight;
    let right = window.innerWidth;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const c = p.getBoundingClientRect();
      top = Math.max(top, c.top);
      left = Math.max(left, c.left);
      bottom = Math.min(bottom, c.bottom);
      right = Math.min(right, c.right);
    }
    const eps = 0.5;
    return r.top < top - eps ||
      r.left < left - eps ||
      r.bottom > bottom + eps ||
      r.right > right + eps
      ? { r: [r.top, r.bottom], clip: [top, bottom] }
      : null;
  });
  expect(clipped, label).toBeNull();
}

const GALAT =
  'Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan mencatat dua kali.';

/** Handoff C1: HP 360×640 dengan bilah status 24 px dan keyboard ±260 px; sheet ≤ 356 px. */
const KEYBOARD = 24 + 260;

test('catat galat muat di atas keyboard', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 360, height: 640 - KEYBOARD });
  await page.goto('/dev/ui#catat-s6');
  await page.getByRole('button', { name: 'S6-C2 Galat simpan' }).click();
  const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
  await expect(sheet.getByLabel('Nominal', { exact: true })).toBeFocused();
  const chips = sheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio');
  await chips.first().click();
  await sheet.getByRole('button', { name: 'Simpan' }).click();

  const alert = sheet.getByRole('alert');
  await expect(alert).toHaveText(GALAT);
  const retry = sheet.getByRole('button', { name: 'Coba lagi' });
  await expect(retry).toBeFocused();
  await expect(retry).toHaveAttribute('aria-describedby', (await alert.getAttribute('id')) ?? '');

  await expectFullyVisible(sheet.getByLabel('Nominal', { exact: true }), 'nominal');
  await expectFullyVisible(sheet.getByRole('heading', { name: 'Pribadi' }), 'label ruang');
  expect(await chips.count()).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < 4; i++) await expectFullyVisible(chips.nth(i), `chip ${String(i)}`);
  await expectFullyVisible(sheet.getByLabel('Dari dompet'), 'dompet');
  await expectFullyVisible(alert, 'pesan galat');
  await expectFullyVisible(retry, 'Coba lagi');
  const height = (await sheet.boundingBox())?.height ?? Infinity;
  expect(height).toBeLessThanOrEqual(356);
  const scrolled = await sheet.evaluate((el) =>
    [el, ...el.querySelectorAll('*')].some((n) => n.scrollTop > 0),
  );
  expect(scrolled).toBe(false);
});

test.describe('keadaan simpan 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('menyimpan: tombol aria-busy, tidak disabled, sheet tidak bisa ditutup', async ({
    page,
  }) => {
    await page.goto('/dev/ui#catat-s6');
    await page.getByRole('button', { name: 'S6-C1 Menyimpan…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    await sheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio').first().click();
    await sheet.getByRole('button', { name: 'Simpan' }).click();
    const busy = sheet.getByRole('button', { name: 'Menyimpan…' });
    await expect(busy).toHaveAttribute('aria-busy', 'true');
    await expect(busy).toHaveAttribute('aria-disabled', 'true');
    // aria-disabled, bukan atribut disabled (R8): fokus tetap di tombol.
    await expect(busy).not.toHaveAttribute('disabled');
    await expect(busy).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeVisible();
  });

  test('saldo kurang: baris peringatan di bawah dompet + Tetap simpan', async ({ page }) => {
    await page.goto('/dev/ui#catat-s6');
    await page.getByRole('button', { name: 'S6-C3 Saldo tidak cukup' }).click();
    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    await sheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio').first().click();
    await sheet.getByRole('button', { name: 'Simpan' }).click();
    const row = sheet.getByRole('status').filter({ hasText: 'Saldo BCA' });
    await expect(row).toHaveText(
      'Saldo BCA tinggal Rp 120.000. Kalau disimpan, saldonya jadi −Rp 30.000.',
    );
    const anyway = sheet.getByRole('button', { name: 'Tetap simpan' });
    await expect(anyway).toBeFocused();
    await expect(anyway).toHaveAttribute('aria-describedby', (await row.getAttribute('id')) ?? '');
  });

  test('before_opening: kolom Tanggal aria-invalid dan mendapat fokus', async ({ page }) => {
    await page.goto('/dev/ui#catat-s6');
    await page.getByRole('button', { name: 'S6-C5 Sebelum dompet dibuka' }).click();
    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    await sheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio').first().click();
    await sheet.getByRole('button', { name: 'Simpan' }).click();
    const date = sheet.getByLabel('Tanggal');
    await expect(date).toBeFocused();
    await expect(date).toHaveAttribute('aria-invalid', 'true');
    await expect(date).toHaveAccessibleDescription(
      'BCA baru dicatat sejak 25 Okt. Pilih tanggal 25 Okt atau sesudahnya.',
    );
  });

  test('ruang tanpa dompet: deskripsi dialog dan fokus awal di Tambah dompet', async ({ page }) => {
    await page.goto('/dev/ui#catat-s6');
    await page.getByRole('button', { name: 'S6-C6 Ruang tanpa dompet' }).click();
    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Bersama' });
    await expect(sheet).toHaveAccessibleDescription(
      'Belum ada dompet di Bersama. Tambah dompet dulu untuk mencatat.',
    );
    await expect(sheet.getByRole('button', { name: 'Tambah dompet' })).toBeFocused();
  });
});
