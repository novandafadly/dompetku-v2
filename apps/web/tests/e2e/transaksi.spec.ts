import { createSeed, groupByDay, monthSummary } from '@dompetku/demo-data';
import type { Entry, Ruang } from '@dompetku/demo-data';
import { formatRupiah, monthName } from '@dompetku/domain';
import { expect, test, type Page } from '@playwright/test';

const TODAY = '2026-10-17';
const q = `today=${TODAY}`;
const full = createSeed({ today: TODAY, variant: 'full' });

function liveInMonth(ruang: Ruang, month: string): Entry[] {
  return full.entries.filter(
    (e) => e.ruang === ruang && e.voidedAt === undefined && e.occurredOn.startsWith(month),
  );
}

function accountName(id: string): string {
  return full.accounts.find((a) => a.id === id)?.name ?? '';
}

function rows(page: Page) {
  return page.getByRole('main').getByRole('listitem');
}

function toasts(page: Page) {
  return page.getByRole('region', { name: /Notifikasi/ });
}

test.describe('Transaksi 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('segmen, filter, grup per hari dan baris 60 px', async ({ page }) => {
    await page.goto(`/pribadi/transaksi?${q}`);
    const main = page.getByRole('main');
    await expect(main.getByRole('tablist', { name: 'Tampilan' }).getByRole('tab')).toHaveText([
      'Daftar',
      'Ringkasan',
    ]);
    await expect(main.getByRole('tab', { name: 'Daftar' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(main.getByRole('radiogroup', { name: 'Filter' }).getByRole('radio')).toHaveText([
      'Semua',
      'Operasional',
      'Kantor',
      'Menunggu reimburse',
    ]);
    await expect(main.getByText('Oktober 2026')).toBeVisible();

    const groups = groupByDay(liveInMonth('pribadi', '2026-10'), TODAY);
    const first = groups[0];
    if (!first) throw new Error('seed kosong');
    const group = main.getByRole('region', { name: new RegExp(`^${first.label}`) });
    await expect(group.getByRole('heading', { level: 3 })).toContainText(first.label);
    await expect(group.getByRole('heading', { level: 3 })).toContainText(formatRupiah(first.net));
    await expect(rows(page)).toHaveCount(liveInMonth('pribadi', '2026-10').length);

    const top = first.items[0];
    if (!top) throw new Error('grup kosong');
    const row = rows(page).first();
    await expect(row).toContainText(top.description ?? '');
    await expect(row).toContainText(`· ${accountName(top.accountId)}`);
    await expect(row).toContainText(formatRupiah(top.amount));
    const box = await row.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(60);
    // Nominal rata kanan.
    const amountBox = await row.locator('.num').first().boundingBox();
    const rowBox = await row.boundingBox();
    expect(
      (rowBox?.x ?? 0) + (rowBox?.width ?? 0) - ((amountBox?.x ?? 0) + (amountBox?.width ?? 0)),
    ).toBeLessThan(24);
  });

  test('pencarian parkir dan filter tanpa hasil', async ({ page }) => {
    await page.goto(`/pribadi/transaksi?${q}`);
    const main = page.getByRole('main');
    const needle = 'parkir';
    const expected = liveInMonth('pribadi', '2026-10').filter((e) => {
      const cat = full.categories.find((c) => c.id === e.categoryId)?.name ?? '';
      return [e.description ?? '', cat, accountName(e.accountId)].some((t) =>
        t.toLowerCase().includes(needle),
      );
    });
    expect(expected.length).toBeGreaterThan(0);
    await main.getByRole('searchbox', { name: 'Cari transaksi' }).fill('PARKIR');
    await expect(rows(page)).toHaveCount(expected.length);
    for (const r of await rows(page).all()) await expect(r).toContainText(/parkir/i);
  });

  test('filter Kantor tanpa hasil di Pribadi, Hapus filter mengembalikan semua', async ({
    page,
  }) => {
    // Dengan hari ini 2 Oktober, belum ada entri kantor di Oktober (perjalanan dinas mulai tanggal 9).
    const early = '2026-10-02';
    const seed = createSeed({ today: early, variant: 'full' });
    const live = seed.entries.filter(
      (e) =>
        e.ruang === 'pribadi' && e.voidedAt === undefined && e.occurredOn.startsWith('2026-10'),
    );
    await page.goto(`/pribadi/transaksi?today=${early}`);
    const main = page.getByRole('main');
    await main.getByRole('radio', { name: 'Kantor' }).click();
    await expect(main.getByText('Tidak ada transaksi Kantor di Oktober.')).toBeVisible();
    await main.getByRole('searchbox', { name: 'Cari transaksi' }).fill('zzz');
    await main.getByRole('button', { name: 'Hapus filter' }).click();
    await expect(main.getByRole('radio', { name: 'Semua' })).toBeChecked();
    await expect(main.getByRole('searchbox', { name: 'Cari transaksi' })).toHaveValue('');
    await expect(rows(page)).toHaveCount(live.length);
  });

  test('Bersama hanya punya chip Semua dan Operasional', async ({ page }) => {
    await page.goto(`/bersama/transaksi?${q}`);
    const chips = page
      .getByRole('main')
      .getByRole('radiogroup', { name: 'Filter' })
      .getByRole('radio');
    await expect(chips).toHaveText(['Semua', 'Operasional']);
    await expect(page.getByRole('radio', { name: 'Kantor' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Menunggu reimburse' })).toHaveCount(0);
  });

  test('filter Operasional, Kantor dan Menunggu reimburse', async ({ page }) => {
    await page.goto(`/pribadi/transaksi?${q}`);
    const main = page.getByRole('main');
    const pocketOf = (id: string) => full.accounts.find((a) => a.id === id)?.pocket;
    const oct = liveInMonth('pribadi', '2026-10');
    await main.getByRole('radio', { name: 'Operasional' }).click();
    await expect(rows(page)).toHaveCount(
      oct.filter((e) => pocketOf(e.accountId) === 'operasional').length,
    );
    await main.getByRole('radio', { name: 'Kantor' }).click();
    await expect(rows(page)).toHaveCount(
      oct.filter((e) => pocketOf(e.accountId) === 'kantor').length,
    );
    await main.getByRole('radio', { name: 'Menunggu reimburse' }).click();
    const waiting = oct.filter((e) => e.kind === 'expense' && e.reimbursable === true);
    expect(waiting.length).toBeGreaterThan(0);
    await expect(rows(page)).toHaveCount(waiting.length);
  });

  test('navigasi bulan dan Muat lagi', async ({ page }) => {
    await page.goto(`/pribadi/transaksi?${q}`);
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Bulan berikutnya' })).toBeDisabled();
    await expect(main.getByRole('button', { name: 'Muat lagi' })).toHaveCount(0);

    await main.getByRole('button', { name: 'Bulan sebelumnya' }).click();
    await expect(main.getByText('September 2026')).toBeVisible();
    const sep = liveInMonth('pribadi', '2026-09').length;
    expect(sep).toBeGreaterThan(50);
    await expect(rows(page)).toHaveCount(50);
    await main.getByRole('button', { name: 'Muat lagi' }).click();
    await expect(rows(page)).toHaveCount(Math.min(100, sep));
    await expect(main.getByRole('button', { name: 'Muat lagi' })).toHaveCount(0);

    await main.getByRole('button', { name: 'Bulan berikutnya' }).click();
    await expect(main.getByText('Oktober 2026')).toBeVisible();
    expect(monthName('2026-10')).toBe('Oktober');
  });

  test('bulan terpilih ada di URL dan bertahan daftar, detail, kembali', async ({ page }) => {
    await page.goto(`/pribadi/transaksi?${q}`);
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Bulan sebelumnya' }).click();
    await expect(main.getByText('September 2026')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/pribadi/transaksi\\?${q}&bulan=2026-09$`));
    await rows(page).first().getByRole('link').click();
    await expect(page).toHaveURL(/\/pribadi\/transaksi\/[^/?]+\?.*bulan=2026-09/);
    await page.getByRole('main').getByRole('link', { name: 'Transaksi', exact: true }).click();
    await expect(main.getByText('September 2026')).toBeVisible();
    // Tab lain tidak mewarisi bulan.
    const beranda = page
      .getByRole('navigation', { name: 'Tab utama' })
      .getByRole('link', { name: 'Beranda' });
    expect(await beranda.getAttribute('href')).not.toContain('bulan');
    // Nilai tidak valid atau di masa depan kembali ke bulan ini.
    await page.goto(`/pribadi/transaksi?${q}&bulan=2027-03`);
    await expect(page.getByRole('main').getByText('Oktober 2026')).toBeVisible();
    await page.goto(`/pribadi/transaksi?${q}&bulan=abc`);
    await expect(page.getByRole('main').getByText('Oktober 2026')).toBeVisible();
  });

  test('detail Pribadi: dicatat oleh kamu, Ubah dan Pindahkan', async ({ page }) => {
    await page.goto(`/pribadi/transaksi?${q}`);
    await rows(page).first().getByRole('link').click();
    const main = page.getByRole('main');
    await expect(main.getByRole('definition').filter({ hasText: /^kamu$/ })).toBeVisible();
    await expect(main.getByText('Dicatat oleh')).toBeVisible();
    expect(page.url()).toContain(q);
    await main.getByRole('button', { name: 'Ubah' }).click();
    await expect(toasts(page).getByText('Segera di M1')).toBeVisible();
    await main.getByRole('button', { name: 'Pindahkan ke ruang lain' }).click();
    await expect(toasts(page).getByText('Segera di M1').first()).toBeVisible();
    await expect(main.getByRole('button', { name: 'Batalkan' })).toBeVisible();
  });

  test('detail Bersama: dicatat oleh Farida; ruang lain atau id asing 404', async ({ page }) => {
    const byFarida = full.entries.find(
      (e) => e.ruang === 'bersama' && e.createdBy === 'm-farida' && e.kind === 'expense',
    );
    const mine = full.entries.find((e) => e.ruang === 'pribadi' && e.kind === 'expense');
    if (!byFarida || !mine) throw new Error('seed tanpa entri');
    await page.goto(`/bersama/transaksi/${byFarida.id}?${q}`);
    await expect(
      page
        .getByRole('main')
        .getByRole('definition')
        .filter({ hasText: /^Farida$/ }),
    ).toBeVisible();

    await page.goto(`/bersama/transaksi/${mine.id}?${q}`);
    await expect(page.getByText('This page could not be found.')).toBeVisible();
    await page.goto(`/pribadi/transaksi/tidak-ada?${q}`);
    await expect(page.getByText('This page could not be found.')).toBeVisible();
  });

  test('batalkan lalu urungkan', async ({ page }) => {
    const top = groupByDay(liveInMonth('pribadi', '2026-10'), TODAY)[0]?.items[0];
    if (!top) throw new Error('seed kosong');
    expect(top.kind).toBe('expense');
    const bank = accountName(top.accountId);
    const amount = formatRupiah(top.amount);
    const total = liveInMonth('pribadi', '2026-10').length;

    await page.goto(`/pribadi/transaksi?${q}`);
    await rows(page).first().getByRole('link').click();
    await page.getByRole('main').getByRole('button', { name: 'Batalkan' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(
      `Transaksi ${amount} dibatalkan. Saldo ${bank} bertambah ${amount}. Bisa dipulihkan 90 hari dari Sampah.`,
    );
    await dialog.getByRole('button', { name: 'Batalkan transaksi' }).click();

    await expect(page).toHaveURL(new RegExp(`/pribadi/transaksi\\?${q}$`));
    await expect(rows(page)).toHaveCount(total - 1);
    await expect(page.locator(`a[href*="/transaksi/${top.id}?"]`)).toHaveCount(0);
    const toast = toasts(page);
    await expect(toast.getByText(`Dibatalkan di Pribadi · ${amount} dari ${bank}`)).toBeVisible();
    await toast.getByRole('button', { name: 'Urungkan' }).click();
    await expect(rows(page)).toHaveCount(total);
    await expect(page.locator(`a[href*="/transaksi/${top.id}?"]`)).toHaveCount(1);
  });

  test('batalkan transfer menyebut kedua saldo', async ({ page }) => {
    const tf = full.entries.find(
      (e) =>
        e.ruang === 'pribadi' &&
        e.kind === 'transfer' &&
        e.occurredOn.startsWith('2026-10') &&
        e.counterAccountId !== undefined,
    );
    if (!tf?.counterAccountId) throw new Error('seed tanpa transfer');
    const amount = formatRupiah(tf.amount);
    await page.goto(`/pribadi/transaksi/${tf.id}?${q}`);
    await page.getByRole('main').getByRole('button', { name: 'Batalkan' }).click();
    await expect(page.getByRole('alertdialog')).toContainText(
      `Saldo ${accountName(tf.accountId)} bertambah ${amount}, saldo ${accountName(tf.counterAccountId)} berkurang ${amount}.`,
    );
  });

  test('Ringkasan bulan berjalan', async ({ page }) => {
    await page.goto(`/pribadi/transaksi?${q}`);
    const main = page.getByRole('main');
    await main.getByRole('tab', { name: 'Ringkasan' }).click();
    const s = monthSummary(full, 'pribadi', '2026-10');
    await expect(
      main.getByRole('group', { name: 'Bulan' }).getByText('Oktober 2026'),
    ).toBeVisible();
    await expect(main.getByRole('tabpanel')).toContainText('Anggaran bulan ini');
    // Angka tertulis langsung (dari halaman yang tampil), bukan hanya dari selector.
    await expect(main.getByRole('row', { name: /Pengeluaran/ })).toContainText('Rp 2.427.000');
    await expect(main.getByRole('row', { name: /Selisih/ })).toContainText('\u2212Rp 2.427.000');
    await expect(
      main.getByText('Tidak termasuk: Kas kantor Rp 334.000, Transfer internal Rp 1.000.000'),
    ).toBeVisible();
    await expect(main.getByRole('row', { name: /Pemasukan/ })).toContainText(
      formatRupiah(s.pemasukan),
    );
    await expect(main.getByRole('row', { name: /Pengeluaran/ })).toContainText(
      formatRupiah(s.pengeluaran),
    );
    await expect(main.getByRole('row', { name: /Selisih/ })).toContainText(formatRupiah(s.selisih));
    await expect(
      main.getByText(
        `Tidak termasuk: Kas kantor ${formatRupiah(s.kantor)}, Transfer internal ${formatRupiah(s.transfer)}`,
      ),
    ).toBeVisible();
  });
});

test.describe('Transaksi 320', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('tanpa gulir horizontal', async ({ page }) => {
    for (const path of ['/pribadi/transaksi', '/bersama/transaksi']) {
      await page.goto(`${path}?${q}`);
      await expect(rows(page).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        320,
      );
      await page.getByRole('main').getByRole('tab', { name: 'Ringkasan' }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        320,
      );
    }
    const id = full.entries.find((e) => e.ruang === 'pribadi' && e.kind === 'expense')?.id ?? '';
    await page.goto(`/pribadi/transaksi/${id}?${q}`);
    await expect(page.getByRole('main').getByRole('button', { name: 'Batalkan' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });
});
