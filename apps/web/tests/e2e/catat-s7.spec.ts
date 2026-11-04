import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * S7-C1 (transfer antar ruang) dan S7-C2 (talangan) di mode prototipe, plus bukti ukuran yang
 * diminta bingkai (docs/design/s7-bingkai.md): tinggi mode keyboard 360×640 dengan toggle Talangan,
 * lebar MetaSelect, dan chip `Ruang lain…` + chip terpilih di 320 px.
 */

const q = 'today=2026-10-17';

function openCatat(page: Page) {
  return page.getByRole('button', { name: 'Catat', exact: true }).filter({ visible: true });
}

function toasts(page: Page) {
  return page.getByRole('region', { name: /Notifikasi/ });
}

/** Terlihat utuh: di dalam viewport dan tidak terpotong kontainer gulir mana pun. */
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
      ? { r: [r.top, r.bottom, r.left, r.right], clip: [top, bottom, left, right] }
      : null;
  });
  expect(clipped, label).toBeNull();
}

/**
 * Jam dikunci ke 08:00 WIB (selaras `today=2026-10-17`): saran kategori bergantung jam WIB, dan
 * urutan chip memengaruhi tes chip di berkas ini (mis. 11:00–13:59 WIB menggeser kolom chip).
 */
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-17T01:00:00Z'));
});

async function toTransfer(page: Page, ruang: 'Pribadi' | 'Bersama' = 'Pribadi') {
  const sheet = page.getByRole('dialog', { name: `Pengeluaran · ${ruang}` });
  await sheet.getByRole('button', { name: `Pengeluaran · ${ruang}` }).click();
  await page.getByRole('menuitemradio', { name: 'Transfer' }).click();
  return page.getByRole('dialog', { name: `Transfer · ${ruang}` });
}

test.describe('Catat S7 · transfer antar ruang', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Pribadi → Bersama: pilih dompet di ruang lain, simpan, toast tanpa nama dompet, Urungkan', async ({
    page,
  }) => {
    await page.goto(`/pribadi/beranda?${q}`);
    await openCatat(page).click();
    await expect(page.getByLabel('Nominal', { exact: true })).toBeFocused();
    let sheet = await toTransfer(page);
    await sheet.getByLabel('Nominal', { exact: true }).fill('20000');
    await sheet.getByRole('button', { name: 'Pilih dompet di ruang lain' }).click();
    const group = page.getByRole('radiogroup', { name: 'Dompet di Bersama' });
    await expect(group).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ke dompet di Bersama' })).toBeVisible();
    await group.getByRole('radio', { name: /Kas Rumah/ }).click();
    sheet = page.getByRole('dialog', { name: 'Transfer · Pribadi → Bersama' });
    await expect(sheet.getByRole('radio', { name: 'Kas Rumah · Bersama' })).toBeFocused();
    await sheet.getByRole('button', { name: 'Tambah keterangan' }).click();
    await sheet.getByLabel(/Catatan untuk Bersama/).fill('Setoran bulanan');
    await sheet.getByRole('button', { name: 'Simpan' }).click();
    const toast = toasts(page).getByText(/^Tersimpan di Pribadi · Rp\s20\.000 ke Bersama$/);
    await expect(toast).toBeVisible();
    await expect(toasts(page).getByText(/BCA|Kas Rumah/)).toHaveCount(0);

    // Kaki Bersama muncul di Beranda Bersama sebagai setoran; Urungkan membatalkan keduanya.
    await toasts(page).getByRole('button', { name: 'Urungkan' }).click();
    await expect(toasts(page).getByText(/Belum bisa diurungkan/)).toHaveCount(0);
  });

  test('sumber Kantor: Ruang lain… tidak ditawarkan; Esc di halaman dalam hanya kembali', async ({
    page,
  }) => {
    await page.goto(`/pribadi/beranda?${q}`);
    await openCatat(page).click();
    const sheet = await toTransfer(page);
    await sheet.getByLabel('Dari dompet').selectOption({ label: 'Kas Kantor' });
    await expect(sheet.getByRole('button', { name: 'Pilih dompet di ruang lain' })).toHaveCount(0);
    await expect(
      sheet.getByText('Dompet Kantor tidak bisa ikut transfer antar ruang.'),
    ).toBeVisible();

    await sheet.getByLabel('Dari dompet').selectOption({ label: 'BCA' });
    await sheet.getByRole('button', { name: 'Pilih dompet di ruang lain' }).click();
    await expect(page.getByRole('radiogroup', { name: 'Dompet di Bersama' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Transfer · Pribadi' })).toBeVisible();
    await expect(
      page.getByRole('dialog', { name: 'Transfer · Pribadi' }).getByRole('button', {
        name: 'Pilih dompet di ruang lain',
      }),
    ).toBeFocused();
  });
});

test.describe('Catat S7 · talangan', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('toggle Talangan: petunjuk satu baris dan toast Talangan kantor', async ({ page }) => {
    await page.goto(`/pribadi/beranda?${q}`);
    await openCatat(page).click();
    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    await expect(sheet.getByLabel('Nominal', { exact: true })).toBeFocused();
    await page.keyboard.type('50000');
    const toggle = sheet.getByRole('switch', { name: 'Talangan kantor' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    const box = await toggle.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(
      sheet.getByText('Tidak masuk hitungan pribadi. Tercatat di Menunggu reimburse.'),
    ).toBeVisible();
    await sheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio').first().click();
    await sheet.getByRole('button', { name: 'Simpan' }).click();
    await expect(toasts(page).getByText(/ · Talangan kantor$/)).toBeVisible();
  });

  test('di Bersama tidak ada toggle Talangan', async ({ page }) => {
    await page.goto(`/bersama/beranda?${q}`);
    await openCatat(page).click();
    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Bersama' });
    await expect(sheet.getByLabel('Nominal', { exact: true })).toBeFocused();
    await expect(sheet.getByRole('switch')).toHaveCount(0);
  });
});

/** Mode keyboard HP (bingkai S7-C2): 360×640 dikurangi bilah status 24 px dan keyboard 260 px. */
const KEYBOARD = 24 + 260;

// 360×640 dengan keyboard (tinggi sheet ≤ 356); 320×568 tanpa keyboard: hanya lebar yang dibuktikan
// (sheet S6 pun tidak dijanjikan muat di atas keyboard pada 568 px).
for (const size of [
  { width: 360, height: 640, keyboard: true },
  { width: 320, height: 568, keyboard: false },
]) {
  test(`Talangan aktif ${size.keyboard ? 'di mode keyboard ' : ''}${String(size.width)}×${String(size.height)}: satu baris meta, semua terlihat, tanpa gulir`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({
      width: size.width,
      height: size.keyboard ? size.height - KEYBOARD : size.height,
    });
    await page.goto(`/pribadi/beranda?${q}`);
    await openCatat(page).click();
    const sheet = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    await expect(sheet.getByLabel('Nominal', { exact: true })).toBeFocused();
    await page.keyboard.type('35000');
    const chips = sheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio');
    await expect(chips.first()).toBeVisible();
    // Tanpa dan dengan Talangan: tinggi sheet tidak bertambah dan semua tetap terlihat.
    const toggle = sheet.getByRole('switch', { name: 'Talangan kantor' });
    const heightBefore = (await sheet.boundingBox())?.height ?? 0;
    await chips.first().click();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    const heightAfter = (await sheet.boundingBox())?.height ?? 0;
    // Hanya mode keyboard yang dijanjikan tidak bertambah tinggi (petunjuk satu baris).
    if (size.keyboard) expect(heightAfter).toBeLessThanOrEqual(heightBefore + 1);
    if (size.keyboard) expect(heightAfter).toBeLessThanOrEqual(356);

    await expectFullyVisible(sheet.getByLabel('Nominal', { exact: true }), 'nominal');
    await expectFullyVisible(sheet.getByRole('heading', { name: 'Pribadi' }), 'label ruang');
    // Baris chip HP bisa digeser ke samping; di 320 px hanya chip pertama yang pasti utuh.
    for (let i = 0; i < (size.keyboard ? 4 : 1); i++) {
      await expectFullyVisible(chips.nth(i), `chip ${String(i)}`);
    }
    await expectFullyVisible(sheet.getByLabel('Dari dompet'), 'dompet');
    await expectFullyVisible(toggle, 'toggle talangan');
    await expectFullyVisible(sheet.getByRole('button', { name: 'Simpan' }), 'Simpan');

    // Baris meta tetap satu baris (semua kontrol sejajar), toggle 44×44, MetaSelect ≥ 88 px.
    const rect = async (l: Locator) => {
      const b = await l.boundingBox();
      if (b === null) throw new Error('tanpa kotak');
      return b;
    };
    const dompet = await rect(sheet.getByLabel('Dari dompet'));
    const tanggal = await rect(sheet.getByLabel('Tanggal'));
    const note = await rect(sheet.getByRole('button', { name: 'Tambah keterangan' }));
    const sw = await rect(toggle);
    for (const r of [tanggal, note, sw]) expect(Math.abs(r.y - dompet.y)).toBeLessThan(1);
    expect(dompet.height).toBeLessThanOrEqual(44.5);
    expect(sw.width).toBeGreaterThanOrEqual(44);
    expect(sw.height).toBeGreaterThanOrEqual(44);
    expect(dompet.width).toBeGreaterThanOrEqual(88);
    expect(tanggal.width).toBeGreaterThanOrEqual(88);
    // Petunjuk Talangan di mode keyboard: versi pendek utuh satu baris (tidak terpotong).
    if (size.keyboard) {
      const hint = sheet.getByTestId('talangan-hint');
      await expect(hint).toHaveText('Tidak masuk hitungan pribadi.');
      const cut = await hint.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(cut).toBeLessThanOrEqual(0);
      expect((await hint.boundingBox())?.height ?? 999).toBeLessThanOrEqual(20);
    }
    // `Hari ini` tidak terpotong: lebar area teks Select tanggal ≥ lebar teksnya (diukur di kanvas).
    const room = await sheet.getByLabel('Tanggal').evaluate((el) => {
      const cs = getComputedStyle(el);
      const area =
        el.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return { area, need: 0 };
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const text = (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? '';
      return { area, need: ctx.measureText(text).width };
    });
    // 320 px: dua Select ±88 px; bingkai S7-C2 menerima nilai terpotong ellipsis di sana.
    if (size.width >= 360) expect(room.area, 'area teks tanggal').toBeGreaterThanOrEqual(room.need);
    // Tidak ada gulir (vertikal di sheet, horizontal di halaman).
    const scrolled = await sheet.evaluate((el) =>
      [el, ...el.querySelectorAll('*')].some((n) => n.scrollTop > 0),
    );
    expect(scrolled).toBe(false);
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflowX).toBeLessThanOrEqual(0);
  });
}

test('320 px: Ruang lain… dan chip terpilih {Dompet} · {Ruang} muat tanpa gulir horizontal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`/pribadi/beranda?${q}`);
  await openCatat(page).click();
  const sheet = await toTransfer(page);
  await sheet.getByLabel('Nominal', { exact: true }).fill('12345678900');
  await sheet.getByRole('button', { name: 'Pilih dompet di ruang lain' }).click();
  await page
    .getByRole('radiogroup', { name: 'Dompet di Bersama' })
    .getByRole('radio')
    .last()
    .click();
  const bersama = page.getByRole('dialog', { name: 'Transfer · Pribadi → Bersama' });
  const chosen = bersama.getByRole('radio', { name: /· Bersama$/ });
  await expect(chosen).toBeVisible();
  const more = bersama.getByRole('button', { name: 'Pilih dompet di ruang lain' });
  await expectFullyVisible(chosen, 'chip terpilih');
  await expectFullyVisible(more, 'Ruang lain…');
  const overflowX = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflowX).toBeLessThanOrEqual(0);
  // Chip tidak lebih lebar dari area isi sheet (288 px).
  const w = (await chosen.boundingBox())?.width ?? 999;
  expect(w).toBeLessThanOrEqual(288);
  // Judul dua ruang: satu baris dan kedua nama ruang utuh (tidak terpotong) di 320 px.
  const title = bersama.getByRole('button', { name: /Transfer · Pribadi → Bersama/ });
  expect((await title.boundingBox())?.height ?? 999).toBeLessThanOrEqual(44.5);
  const cut = await title.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(cut).toBeLessThanOrEqual(1);
  await expectFullyVisible(title, 'judul dua ruang');
  const close = bersama.getByRole('button', { name: 'Tutup' });
  const tb = await title.boundingBox();
  const cb = await close.boundingBox();
  expect((tb?.x ?? 0) + (tb?.width ?? 0)).toBeLessThanOrEqual((cb?.x ?? 0) + 0.5);
});
