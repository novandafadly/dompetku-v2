import { parseRupiah } from '@dompetku/domain';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { routeScripts } from './route-scripts';

const q = 'today=2026-10-17';

/** Hitung aksi pointer di seluruh halaman (definisi "ketukan" ui-ux R3). */
async function countTaps(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __taps: number };
    w.__taps = 0;
    window.addEventListener(
      'pointerdown',
      () => {
        w.__taps += 1;
      },
      true,
    );
  });
  return () => page.evaluate(() => (window as unknown as { __taps: number }).__taps);
}

function toasts(page: Page) {
  return page.getByRole('region', { name: /Notifikasi/ });
}

function openCatat(page: Page) {
  return page.getByRole('navigation', { name: 'Tab utama' }).getByRole('button', { name: 'Catat' });
}

async function saveFirstChip(page: Page) {
  await openCatat(page).click();
  const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
  await expect(sheet.getByLabel('Nominal', { exact: true })).toBeFocused();
  await page.keyboard.type('35000');
  const chip = sheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio').first();
  const category = (await chip.innerText()).trim();
  await chip.click();
  await sheet.getByRole('button', { name: 'Simpan' }).click();
  return category;
}

test.describe('Catat 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('pintasan c sebelum kode sheet termuat: angka tidak hilang; Escape kembali ke Catat', async ({
    page,
  }) => {
    // Tahan semua JS di luar HTML rute (sheet Catat, prefetch) sampai dilepas.
    let own = new Set<string>();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let held!: () => void;
    const firstHeld = new Promise<void>((r) => {
      held = r;
    });
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.resourceType() === 'document') {
        const response = await route.fetch();
        const body = await response.text();
        own = routeScripts(body);
        await route.fulfill({ response, body });
        return;
      }
      const path = new URL(request.url()).pathname;
      if (path.endsWith('.js') && !own.has(path)) {
        held();
        await gate;
      }
      await route.continue().catch(() => undefined);
    });

    await page.goto(`/pribadi/beranda?${q}`);
    // Permintaan tertahan pertama (preload senggang/prefetch) baru terjadi setelah hidrasi.
    await firstHeld;
    await page.keyboard.press('c');
    await page.keyboard.type('35000');

    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    const amount = sheet.getByLabel('Nominal', { exact: true });
    await expect(amount).toHaveValue('35.000');
    // Masih placeholder: kode sheet sebenarnya belum dimuat.
    await expect(sheet.getByRole('radiogroup', { name: 'Kategori' })).toHaveCount(0);

    release();
    await expect(sheet.getByRole('radiogroup', { name: 'Kategori' })).toBeVisible();
    await expect(amount).toHaveValue('35.000');
    await expect(amount).toBeFocused();
    await page.keyboard.type('0');
    await expect(amount).toHaveValue('350.000');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(openCatat(page)).toBeFocused();
  });

  test('Escape di placeholder menutup dan mengembalikan fokus ke Catat', async ({ page }) => {
    let own = new Set<string>();
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.resourceType() === 'document') {
        const response = await route.fetch();
        const body = await response.text();
        own = routeScripts(body);
        await route.fulfill({ response, body });
        return;
      }
      const path = new URL(request.url()).pathname;
      // Kode sheet tidak pernah datang dalam tes ini.
      if (path.endsWith('.js') && !own.has(path)) return;
      await route.continue();
    });
    await page.goto(`/pribadi/beranda?${q}`);
    await expect(page.locator('html')).toHaveAttribute('data-hero', 'serif');
    await openCatat(page).click();
    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    await expect(sheet.getByLabel('Nominal', { exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(openCatat(page)).toBeFocused();
  });

  test('three taps from beranda', async ({ page }) => {
    const taps = await countTaps(page);
    await page.goto(`/pribadi/beranda?${q}`);
    const recent = page.getByRole('main').getByRole('region', { name: 'Terakhir' });
    await expect(recent.getByRole('listitem')).toHaveCount(5);
    expect(await taps()).toBe(0);

    const category = await saveFirstChip(page);

    expect(await taps()).toBe(3);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const toast = toasts(page);
    await expect(toast.getByText('Tersimpan di Pribadi · Rp 35.000 dari BCA')).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Urungkan' })).toBeVisible();
    const first = recent.getByRole('listitem').first();
    await expect(first).toContainText(category);
    await expect(first).toContainText('Hari ini · BCA');
    await expect(first).toContainText('35.000');
  });

  test('Bersama expense under ?today shows in Aktivitas as Hari ini, not a future date', async ({
    page,
  }) => {
    await page.goto(`/bersama/beranda?${q}`);
    await openCatat(page).click();
    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Bersama' });
    await expect(sheet.getByLabel('Nominal', { exact: true })).toBeFocused();
    await page.keyboard.type('35000');
    await sheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio').first().click();
    await sheet.getByRole('button', { name: 'Simpan' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const feed = page.getByRole('main').getByRole('region', { name: 'Aktivitas' });
    const first = feed.getByRole('listitem').first();
    await expect(first).toContainText('Pengeluaran:');
    await expect(first).toContainText('Hari ini');
    await expect(first).toContainText(/\d{2}\.\d{2}/);
  });

  test('undo', async ({ page }) => {
    await page.goto(`/pribadi/beranda?${q}`);
    const main = page.getByRole('main');
    const recent = main.getByRole('region', { name: 'Terakhir' });
    await expect(recent.getByRole('listitem')).toHaveCount(5);
    const before = await recent.innerText();
    const saldoRow = main.getByRole('table').getByRole('row', { name: /Saldo operasional/ });
    const saldo = async () => {
      const match = /Rp\s?[\d.]+/.exec(await saldoRow.innerText());
      const amount = match ? parseRupiah(match[0]) : null;
      if (amount === null) throw new Error('saldo tidak terbaca');
      return amount;
    };
    const saldo0 = await saldo();

    await saveFirstChip(page);
    await expect(recent).not.toHaveText(before);
    await expect.poll(saldo).toBe(saldo0 - 35_000);

    await toasts(page).getByRole('button', { name: 'Urungkan' }).click();
    await expect.poll(() => recent.innerText()).toBe(before);
    await expect.poll(saldo).toBe(saldo0);
  });

  test('Escape in Kategori lain closes only the search', async ({ page }) => {
    await page.goto(`/pribadi/beranda?${q}`);
    await openCatat(page).click();
    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    await page.keyboard.type('35000');
    const more = sheet.getByRole('button', { name: 'Kategori lain…' });
    await more.click();
    await expect(sheet.getByRole('combobox', { name: 'Cari kategori' })).toBeFocused();
    await page.keyboard.press('Escape');

    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('combobox', { name: 'Cari kategori' })).toHaveCount(0);
    await expect(sheet.getByLabel('Nominal', { exact: true })).toHaveValue('35.000');
    await expect(more).toBeFocused();

    await more.click();
    await sheet.getByRole('button', { name: 'Batal' }).click();
    await expect(sheet.getByRole('combobox', { name: 'Cari kategori' })).toHaveCount(0);
    await expect(more).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('switch space resets wallet and category', async ({ page }) => {
    await page.goto(`/bersama/beranda?${q}`);
    await openCatat(page).click();
    const bersama = page.getByRole('dialog', { name: 'Pengeluaran · Bersama' });
    const wallet = bersama.getByLabel('Dari dompet');
    await expect(wallet.getByRole('option')).toHaveText(['Kas Rumah', 'Tabungan Liburan']);
    await page.keyboard.type('35000');
    await bersama.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio').first().click();

    await bersama.getByRole('button', { name: 'Pindah ke Pribadi' }).click();

    const pribadi = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    await expect(pribadi).toBeVisible();
    await expect(pribadi.getByLabel('Dari dompet')).toHaveValue('acc-bca');
    await expect(pribadi.getByLabel('Dari dompet').locator('option:checked')).toHaveText('BCA');
    await expect(
      pribadi.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio', { checked: true }),
    ).toHaveCount(0);
    await expect(pribadi.getByLabel('Nominal', { exact: true })).toHaveValue('35.000');
    await expect(pribadi.getByRole('button', { name: 'Simpan' })).toBeDisabled();
  });

  test('Kategori lain… opens a searchable list of all the ruang categories', async ({ page }) => {
    await page.goto(`/pribadi/beranda?${q}`);
    await openCatat(page).click();
    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    await page.keyboard.type('120000');
    await sheet.getByRole('button', { name: 'Kategori lain…' }).click();
    const search = sheet.getByRole('combobox', { name: 'Cari kategori' });
    await expect(search).toBeFocused();
    await search.fill('dinas');
    await sheet.getByRole('option', { name: 'Perjalanan Dinas' }).click();
    await expect(
      sheet.getByRole('radio', { name: 'Perjalanan Dinas', checked: true }),
    ).toBeVisible();
    await sheet.getByRole('button', { name: 'Simpan' }).click();
    await expect(
      toasts(page).getByText('Tersimpan di Pribadi · Rp 120.000 dari BCA'),
    ).toBeVisible();
  });

  test('income and transfer toasts name the wallets', async ({ page }) => {
    await page.goto(`/pribadi/beranda?${q}`);
    await openCatat(page).click();
    let sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    await sheet.getByRole('radio', { name: 'Masuk' }).click();
    sheet = page.getByRole('dialog', { name: 'Pemasukan · Pribadi' });
    await sheet.getByLabel('Nominal', { exact: true }).fill('50000');
    await sheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio').first().click();
    await sheet.getByRole('button', { name: 'Simpan' }).click();
    await expect(toasts(page).getByText('Tersimpan di Pribadi · Rp 50.000 ke BCA')).toBeVisible();

    await openCatat(page).click();
    await page
      .getByRole('dialog', { name: 'Pengeluaran · Pribadi' })
      .getByRole('radio', { name: 'Transfer' })
      .click();
    sheet = page.getByRole('dialog', { name: 'Transfer · Pribadi' });
    await sheet.getByLabel('Nominal', { exact: true }).fill('20000');
    await expect(sheet.getByRole('button', { name: 'Simpan' })).toBeDisabled();
    const to = sheet.getByRole('radiogroup', { name: 'Ke dompet' });
    await expect(to.getByRole('radio', { name: 'BCA' })).toHaveCount(0);
    await to.getByRole('radio', { name: 'Tunai' }).click();
    await sheet.getByRole('button', { name: 'Simpan' }).click();
    await expect(
      toasts(page).getByText('Tersimpan di Pribadi · Rp 20.000 dari BCA ke Tunai'),
    ).toBeVisible();
  });
});

/** Terlihat utuh: di dalam viewport dan tidak terpotong kontainer gulir mana pun (mis. isi sheet di belakang footer). */
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

const KEYBOARD = 300;

for (const size of [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
]) {
  for (const ruang of ['Pribadi', 'Bersama']) {
    test(`catat fits above keyboard ${String(size.width)}×${String(size.height)} ${ruang}`, async ({
      page,
    }) => {
      // Tanpa animasi sheet agar posisi yang diukur adalah posisi akhir.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      // Proksi keyboard OS: area terlihat dikurangi 300 px.
      await page.setViewportSize({ width: size.width, height: size.height - KEYBOARD });
      await page.goto(`/${ruang.toLowerCase()}/beranda?${q}`);
      await openCatat(page).click();
      const sheet = page.getByRole('dialog', { name: `Pengeluaran · ${ruang}` });
      await expect(sheet.getByLabel('Nominal', { exact: true })).toBeFocused();
      await page.keyboard.type('35000');

      await expectFullyVisible(sheet.getByLabel('Nominal', { exact: true }), 'nominal');
      await expectFullyVisible(sheet.getByRole('heading', { name: ruang }), 'label ruang');
      const chips = sheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio');
      expect(await chips.count()).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < 4; i++) await expectFullyVisible(chips.nth(i), `chip ${String(i)}`);
      await expectFullyVisible(sheet.getByLabel('Dari dompet'), 'dompet');
      await expectFullyVisible(sheet.getByRole('button', { name: 'Simpan' }), 'Simpan');
      const scrolled = await sheet.evaluate((el) =>
        [el, ...el.querySelectorAll('*')].some((n) => n.scrollTop > 0),
      );
      expect(scrolled).toBe(false);
    });
  }
}

test.describe('tanggal', () => {
  // Zona browser sengaja bukan WIB: tanggal lokal browser masih 30 Okt.
  test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles' });

  test('default date is today WIB', async ({ page }) => {
    // 17.30 UTC = 00.30 WIB tanggal 31; zona browser tidak boleh dipakai.
    await page.clock.setFixedTime(new Date('2026-10-30T17:30:00Z'));
    await page.goto('/pribadi/beranda');
    await openCatat(page).click();
    const date = page.getByRole('dialog').getByLabel('Tanggal');
    await expect(date).toHaveAttribute('data-date', '2026-10-31');
    await expect(date.locator('option:checked')).toHaveText('Hari ini');
  });
});

test.describe('varian B keypad aplikasi', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keypad 1–9, 000, 0, ⌫ and no OS keyboard', async ({ page }) => {
    await page.goto(`/pribadi/beranda?keypad=app&${q}`);
    await openCatat(page).click();
    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    const amount = sheet.getByLabel('Nominal', { exact: true });
    await expect(amount).toHaveAttribute('inputmode', 'none');
    const keypad = sheet.getByRole('group', { name: 'Keypad nominal' });
    await expect(keypad.getByRole('button')).toHaveText([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '000',
      '0',
      '⌫',
    ]);
    await keypad.getByRole('button', { name: '3', exact: true }).click();
    await keypad.getByRole('button', { name: '5', exact: true }).click();
    await keypad.getByRole('button', { name: '000' }).click();
    await expect(amount).toHaveValue('35.000');
    await keypad.getByRole('button', { name: 'Hapus satu angka' }).click();
    await expect(amount).toHaveValue('3.500');
    await amount.focus();
    await page.keyboard.type('0');
    await expect(amount).toHaveValue('35.000');

    await page.keyboard.press('Escape');
    await page
      .getByRole('navigation', { name: 'Tab utama' })
      .getByRole('link', { name: 'Dompet' })
      .click();
    await expect(page).toHaveURL(/keypad=app/);
  });

  test('varian A uses the numeric OS keyboard and has no in-app keypad', async ({ page }) => {
    await page.goto(`/pribadi/beranda?${q}`);
    await openCatat(page).click();
    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    await expect(sheet.getByLabel('Nominal', { exact: true })).toHaveAttribute(
      'inputmode',
      'numeric',
    );
    await expect(sheet.getByRole('group', { name: 'Keypad nominal' })).toHaveCount(0);
  });
});
