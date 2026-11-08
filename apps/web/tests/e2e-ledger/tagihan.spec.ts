import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../e2e/axe';
import { noHorizontalScroll } from '../e2e-auth/helpers';
import { adminQuery, expect, test } from './fixtures';
import { addWallet, digits, expectRouteBudget, spaceId, toasts, walletBalance } from './helpers';

/**
 * S9 Task 11 mode nyata: Rencana > Tagihan. Tambah, bayar dengan nominal beda (K12), bayar ulang
 * dari tab lain = already_posted, lewati / batalkan lewati (K4), ubah nominal, arsip, galat
 * obligation_double, aman dipakai Beranda tidak berubah bila nominal bayar = perkiraan, Bersama
 * tanpa data Pribadi, axe. Satu urutan serial dengan data sendiri (nama unik); berjalan sendiri
 * atau sesudah spec lain.
 */
test.describe.configure({ mode: 'serial' });

const main = (page: Page) => page.getByRole('main');
const WALLET = 'Dompet Tagihan N';
const A = 'Token Listrik N';
const B = 'Langganan Musik N';
const KAT_A = 'Cicilan & Tagihan';
const KAT_B = 'Langganan';

const billSheet = (page: Page) =>
  page.getByRole('dialog', { name: /^(Tambah tagihan|Ubah tagihan)\s*(Pribadi|Bersama)$/ });
const paySheet = (page: Page) =>
  page.getByRole('dialog', { name: /^Bayar .+\s(Pribadi|Bersama)$/ });
const body = (page: Page, name: string) =>
  main(page).locator('[data-bill-row]').filter({ hasText: name });
const payBtn = (page: Page, name: string) =>
  main(page).getByRole('button', { name: new RegExp(`^Bayar ${name}, Rp`) });

async function openUntil(open: () => Locator, sheet: Locator, field: Locator) {
  await expect(async () => {
    if ((await sheet.count()) === 0) await open().click();
    await expect(field).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

async function addBill(page: Page, name: string, amount: number, kategori: string) {
  await page.goto('/pribadi/rencana?bagian=tagihan');
  const sheet = billSheet(page);
  await openUntil(
    () => main(page).getByRole('button', { name: 'Tambah tagihan' }).first(),
    sheet,
    sheet.getByRole('textbox', { name: 'Nama' }),
  );
  await expect(sheet.getByRole('textbox', { name: 'Nama' })).toBeFocused();
  await sheet.getByRole('textbox', { name: 'Nama' }).fill(name);
  await sheet.getByRole('textbox', { name: 'Perkiraan nominal' }).fill(String(amount));
  await sheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: kategori });
  await sheet.getByRole('combobox', { name: 'Tanggal tiap bulan' }).selectOption('1');
  // Mulai awal bulan ini: kemunculan tanggal 1 sudah ada (lewat jatuh tempo bila hari ini > 1).
  await sheet.getByLabel('Mulai').fill(`${(await today()).iso.slice(0, 7)}-01`);
  await sheet.getByRole('button', { name: 'Simpan tagihan' }).click();
  await expect(toasts(page).getByText(`Tagihan ${name} disimpan · Pribadi`)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(body(page, name).first()).toBeVisible();
}

async function expectFocusKept(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName ?? 'BODY'), { timeout: 5_000 })
    .not.toBe('BODY');
}

async function today(): Promise<{ iso: string; day: number }> {
  const [r] = await adminQuery<{ iso: string; day: number }>(
    "select to_char(app.today(), 'YYYY-MM-DD') as iso, extract(day from app.today())::int as day",
  );
  if (!r) throw new Error('today');
  return r;
}

test('tambah tagihan: validasi, simpan, kemunculan tampil; kemunculan bulan depan di Berikutnya', async ({
  page,
}) => {
  await addWallet(page, 'pribadi', WALLET, 5_000_000);
  await page.goto('/pribadi/rencana?bagian=tagihan');
  const sheet = billSheet(page);
  await openUntil(
    () => main(page).getByRole('button', { name: 'Tambah tagihan' }).first(),
    sheet,
    sheet.getByRole('textbox', { name: 'Nama' }),
  );
  await sheet.getByRole('button', { name: 'Simpan tagihan' }).click();
  await expect(
    sheet.getByRole('alert').filter({ hasText: 'Nama tagihan wajib diisi' }),
  ).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Nama' })).toBeFocused();
  // Mulai di masa lalu: keterangan bulan sebelumnya tidak ditagih.
  await sheet.getByLabel('Mulai').fill('2026-01-01');
  await expect(sheet.getByText(/^Bulan sebelum \w+ tidak ditagih\.$/)).toBeVisible();
  await page.keyboard.press('Escape');
  await addBill(page, A, 485_000, KAT_A);
  await expect(main(page).getByRole('region', { name: 'Berikutnya' })).toContainText(A);
  await expect(payBtn(page, A).first()).toBeVisible();
  const rows = await adminQuery<{ n: number }>(
    `select count(*)::int as n from app.bills where name = $1`,
    [A],
  );
  expect(rows[0]?.n).toBe(1);
});

test('lewat jatuh tempo: ikon + teks bukan warna saja, tanggal 1 sebelum hari ini', async ({
  page,
}) => {
  const t = await today();
  test.skip(t.day === 1, 'tanggal 1: jatuh tempo hari ini, bukan lewat');
  await page.goto('/pribadi/rencana?bagian=tagihan');
  const lewat = main(page).getByRole('region', { name: 'Lewat jatuh tempo' });
  await expect(lewat).toContainText(A);
  await expect(lewat).toContainText(/Lewat \d+ hari/);
  await expect(lewat.locator('svg').first()).toBeVisible();
});

test(
  'bayar dengan nominal beda: saldo turun hari ini, klik ganda = satu entri, lunas, toast Urungkan',
  { tag: ['@C6'] },
  async ({ page }) => {
    const before = await walletBalance(page, 'pribadi', WALLET);
    await page.goto('/pribadi/rencana?bagian=tagihan');
    const sheet = paySheet(page);
    await openUntil(
      () => payBtn(page, A).first(),
      sheet,
      sheet.getByRole('textbox', { name: 'Nominal' }),
    );
    await expect(sheet.getByRole('textbox', { name: 'Nominal' })).toBeFocused();
    await expect(sheet.getByRole('textbox', { name: 'Nominal' })).toHaveValue('485.000');
    await expect(sheet.getByText('Perkiraan Rp 485.000')).toBeVisible();
    // Dompet Kas Kantor (pocket kantor) tidak pernah ditawarkan untuk membayar tagihan.
    const kantor = await adminQuery<{ name: string }>(
      `select name from app.accounts where space_id = $1 and pocket = 'kantor'`,
      [await spaceId('personal')],
    );
    const options = await sheet
      .getByRole('combobox', { name: 'Dompet' })
      .locator('option')
      .allInnerTexts();
    expect(options).toContain(WALLET);
    for (const k of kantor) expect(options).not.toContain(k.name);
    await sheet.getByRole('combobox', { name: 'Dompet' }).selectOption({ label: WALLET });
    await sheet.getByRole('textbox', { name: 'Nominal' }).fill('512000');
    const pay = sheet.getByRole('button', { name: /^Bayar Rp\s512\.000$/ });
    await pay.dblclick();
    await expect(
      toasts(page).getByText(`Tagihan ${A} dibayar di Pribadi · Rp 512.000 dari ${WALLET}`),
    ).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectFocusKept(page);
    const entries = await adminQuery<{ n: number; amount: string }>(
      `select count(*)::int as n, coalesce(max(l.amount),0)::text as amount from app.entries e
       join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
      where e.description = $1 and e.voided_at is null`,
      [A],
    );
    expect(entries[0]?.n).toBe(1);
    expect(entries[0]?.amount).toBe('-512000');
    expect(await walletBalance(page, 'pribadi', WALLET)).toBe(before - 512_000);
    await page.goto('/pribadi/rencana?bagian=tagihan');
    await expect(
      main(page)
        .getByText(/^Lunas · \d+ \w+$/)
        .first(),
    ).toBeVisible();
  },
);

test('bayar ulang dari tab lain = already_posted, tanpa nominal, Muat ulang menutup sheet', async ({
  page,
}) => {
  // Kemunculan terbuka berikutnya (bulan depan, bayar di muka) dibuka di dua tab.
  await page.goto('/pribadi/rencana?bagian=tagihan');
  const sheet = paySheet(page);
  await openUntil(
    () => payBtn(page, A).first(),
    sheet,
    sheet.getByRole('textbox', { name: 'Nominal' }),
  );
  const other = await page.context().newPage();
  await other.goto('/pribadi/rencana?bagian=tagihan');
  const sheet2 = paySheet(other);
  await openUntil(
    () => payBtn(other, A).first(),
    sheet2,
    sheet2.getByRole('textbox', { name: 'Nominal' }),
  );
  await sheet2.getByRole('combobox', { name: 'Dompet' }).selectOption({ label: WALLET });
  await sheet2.getByRole('button', { name: /^Bayar Rp/ }).click();
  await expect(toasts(other).getByText(/dibayar di Pribadi/)).toBeVisible();
  await other.close();
  await sheet.getByRole('combobox', { name: 'Dompet' }).selectOption({ label: WALLET });
  await sheet.getByRole('button', { name: /^Bayar Rp/ }).click();
  const alert = sheet.getByRole('alert');
  await expect(alert).toContainText('Tagihan ini sudah dibayar.');
  expect((await alert.innerText()).includes('Rp')).toBe(false);
  await alert.getByRole('button', { name: 'Muat ulang' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const n = await adminQuery<{ n: number }>(
    `select count(*)::int as n from app.entries where description = $1 and voided_at is null`,
    [A],
  );
  expect(n[0]?.n).toBe(2);
});

test('lewati dan batalkan lewati (K4); entri tidak dibuat', async ({ page }) => {
  await addBill(page, B, 99_000, KAT_B);
  const sheet = paySheet(page);
  await openUntil(
    () => payBtn(page, B).first(),
    sheet,
    sheet.getByRole('button', { name: 'Lewati tagihan ini' }),
  );
  await expect(
    sheet.getByText('Pilih ini bila tagihan sudah dibayar di luar aplikasi.'),
  ).toBeVisible();
  await sheet.getByRole('button', { name: 'Lewati tagihan ini' }).click();
  await expect(toasts(page).getByText(`${B} dilewati · Pribadi`)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const unskip = main(page).getByRole('button', { name: `Batalkan lewati ${B}` });
  await expect(unskip.first()).toBeVisible();
  await expect(main(page).getByText('Dilewati').first()).toBeVisible();
  expect(
    (
      await adminQuery<{ n: number }>(
        `select count(*)::int as n from app.entries where description = $1`,
        [B],
      )
    )[0]?.n,
  ).toBe(0);
  await unskip.first().click();
  await expect(toasts(page).getByText(`${B} kembali ditagih · Pribadi`)).toBeVisible();
  await expect(main(page).getByRole('button', { name: `Batalkan lewati ${B}` })).toHaveCount(0);
  await expect(payBtn(page, B).first()).toBeVisible();
});

test('aman dipakai Beranda tidak berubah saat bayar = perkiraan; berubah hanya selisihnya', async ({
  page,
}) => {
  // Angka utama kartu (bukan saldo operasional di rincian, yang memang turun saat bayar).
  const aman = async () => {
    await page.goto('/pribadi/beranda');
    const text = (await page.getByRole('region', { name: /Aman dipakai/ }).innerText()).replace(
      /\s+/g,
      ' ',
    );
    return /(?:PRIBADI|BERSAMA)\s(Rp\s[\d.]+)/i.exec(text)?.[1] ?? text;
  };
  const before = await aman();
  await page.goto('/pribadi/rencana?bagian=tagihan');
  const sheet = paySheet(page);
  await openUntil(
    () => payBtn(page, B).first(),
    sheet,
    sheet.getByRole('textbox', { name: 'Nominal' }),
  );
  await sheet.getByRole('combobox', { name: 'Dompet' }).selectOption({ label: WALLET });
  await sheet.getByRole('button', { name: /^Bayar Rp\s99\.000$/ }).click();
  await expect(toasts(page).getByText(`Tagihan ${B} dibayar di Pribadi`)).toBeVisible();
  expect(await aman()).toBe(before);
});

const C = 'Uji Undo N';

test('Urungkan bayar: entri batal, baris kembali punya tombol Bayar', async ({ page }) => {
  await addBill(page, C, 50_000, KAT_A);
  const sheet = paySheet(page);
  await openUntil(
    () => payBtn(page, C).first(),
    sheet,
    sheet.getByRole('textbox', { name: 'Nominal' }),
  );
  await sheet.getByRole('combobox', { name: 'Dompet' }).selectOption({ label: WALLET });
  await sheet.getByRole('button', { name: /^Bayar Rp/ }).click();
  await expect(toasts(page).getByText(new RegExp(`^Tagihan ${C} dibayar`))).toBeVisible();
  await expect(
    main(page)
      .getByText(/^Lunas · /)
      .first(),
  ).toBeVisible();
  const before = await payBtn(page, C).count();
  await toasts(page).getByRole('button', { name: 'Urungkan' }).first().click();
  await expect(async () => {
    expect(await payBtn(page, C).count()).toBe(before + 1);
  }).toPass();
  const n = await adminQuery<{ n: number }>(
    `select count(*)::int as n from app.entries where description = $1 and voided_at is null`,
    [C],
  );
  expect(n[0]?.n).toBe(0);
});

test('saldo kurang: peringatan, lalu Tetap bayar sampai server (saldo jadi minus)', async ({
  page,
}) => {
  const SMALL = 'Dompet Kecil N';
  await addWallet(page, 'pribadi', SMALL, 10_000);
  // 320 px: peringatan saldo membuat isi sheet lebih tinggi dari layar (S9-C9).
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/pribadi/rencana?bagian=tagihan');
  const sheet = paySheet(page);
  await openUntil(
    () => payBtn(page, C).first(),
    sheet,
    sheet.getByRole('textbox', { name: 'Nominal' }),
  );
  await sheet.getByRole('combobox', { name: 'Dompet' }).selectOption({ label: SMALL });
  await sheet.getByRole('button', { name: /^Bayar Rp\s50\.000$/ }).click();
  await expect(sheet.getByRole('status')).toContainText(
    `Saldo ${SMALL} tinggal Rp 10.000. Kalau dibayar, saldonya jadi −Rp 40.000.`,
  );
  await expect(sheet.getByRole('alert')).toHaveCount(0);
  // S9-C9: `Lewati tagihan ini` bisa digulir ke pandangan, utuh di atas footer (tidak tertutup),
  // dan target sentuhnya ≥ 44 px.
  const skipBtn = sheet.getByRole('button', { name: 'Lewati tagihan ini' });
  await skipBtn.scrollIntoViewIfNeeded();
  const skipBox = await skipBtn.boundingBox();
  const footerBox = await sheet.getByRole('button', { name: 'Tetap bayar' }).boundingBox();
  expect(skipBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect((skipBox?.y ?? 0) + (skipBox?.height ?? 0)).toBeLessThanOrEqual(footerBox?.y ?? 0);
  expect(
    await skipBtn.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }),
  ).toBe(true);
  expect(
    (
      await adminQuery<{ n: number }>(
        `select count(*)::int as n from app.entries where description = $1 and voided_at is null`,
        [C],
      )
    )[0]?.n,
  ).toBe(0);
  await sheet.getByRole('button', { name: 'Tetap bayar' }).click();
  await expect(
    toasts(page).getByText(new RegExp(`dibayar di Pribadi · Rp\\s50\\.000 dari ${SMALL}`)),
  ).toBeVisible();
  expect(
    (
      await adminQuery<{ n: number }>(
        `select count(*)::int as n from app.entries where description = $1 and voided_at is null`,
        [C],
      )
    )[0]?.n,
  ).toBe(1);
});

test('ubah tagihan: nominal diganti, berlaku untuk kemunculan terbuka', async ({ page }) => {
  await page.goto('/pribadi/rencana?bagian=tagihan');
  const sheet = billSheet(page);
  await openUntil(
    () => body(page, A).last(),
    sheet,
    sheet.getByRole('textbox', { name: 'Perkiraan nominal' }),
  );
  await expect(
    sheet.getByText('Berlaku untuk tagihan yang belum dibayar mulai hari ini.'),
  ).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Perkiraan nominal' })).toBeFocused();
  await sheet.getByRole('textbox', { name: 'Perkiraan nominal' }).fill('520000');
  await sheet.getByRole('button', { name: 'Simpan tagihan' }).click();
  await expect(toasts(page).getByText(`Tagihan ${A} disimpan · Pribadi`)).toBeVisible();
  await expectFocusKept(page);
  const [b] = await adminQuery<{ amount: string }>(
    `select amount::text from app.bills where name = $1`,
    [A],
  );
  expect(b?.amount).toBe('520000');
});

test('obligation_double: tagihan pada kategori beranggaran wajib; jalan keluar kategori lain', async ({
  page,
}) => {
  const sid = await spaceId('personal');
  await adminQuery(
    `insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by)
     select $1, c.id, (select label_month from app.pay_period($1, app.today())), 700000, true, u.id
       from app.categories c, auth."user" u where c.space_id = $1 and c.name = 'Hiburan' limit 1`,
    [sid],
  );
  try {
    // 320 px: isian lebih tinggi dari layar, fokus galat menggulir sheet (S9-C8).
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/pribadi/rencana?bagian=tagihan');
    const sheet = billSheet(page);
    await openUntil(
      () => main(page).getByRole('button', { name: 'Tambah tagihan' }).first(),
      sheet,
      sheet.getByRole('textbox', { name: 'Nama' }),
    );
    await sheet.getByRole('textbox', { name: 'Nama' }).fill('Bioskop Bulanan');
    await sheet.getByRole('textbox', { name: 'Perkiraan nominal' }).fill('100000');
    await sheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: 'Hiburan' });
    // Kemunculan tanggal 1 bulan ini jatuh di periode anggaran yang sama: kewajiban ganda.
    await sheet.getByRole('combobox', { name: 'Tanggal tiap bulan' }).selectOption('1');
    await sheet.getByLabel('Mulai').fill(`${(await today()).iso.slice(0, 7)}-01`);
    await sheet.getByRole('button', { name: 'Simpan tagihan' }).click();
    await expect(
      sheet.getByText(
        'Kategori Hiburan sudah punya anggaran wajib. Satu kewajiban cukup dicatat sekali: jadikan anggarannya tidak wajib atau pilih kategori lain.',
      ),
    ).toBeVisible();
    await expect(sheet.getByRole('combobox', { name: 'Kategori' })).toBeFocused();
    // S9-C8: kolom bergalat tidak menempel ke header sheet; labelnya tetap terlihat di bawah header.
    const header = await sheet.locator('header').boundingBox();
    const label = await sheet.locator('label', { hasText: /^Kategori$/ }).boundingBox();
    expect(label?.y ?? 0).toBeGreaterThanOrEqual((header?.y ?? 0) + (header?.height ?? 0));
    expect(
      await adminQuery('select 1 from app.bills where name = $1', ['Bioskop Bulanan']),
    ).toHaveLength(0);
    await sheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: KAT_B });
    await sheet.getByRole('button', { name: 'Simpan tagihan' }).click();
    await expect(
      toasts(page).getByText('Tagihan Bioskop Bulanan disimpan · Pribadi'),
    ).toBeVisible();
  } finally {
    await adminQuery(
      `delete from app.budgets where space_id = $1 and category_id in (select id from app.categories where space_id = $1 and name = 'Hiburan')`,
      [sid],
    );
  }
});

test('arsip: dialog dengan fokus awal Kembali; tagihan pindah ke Diarsipkan, baca-saja', async ({
  page,
}) => {
  await page.goto('/pribadi/rencana?bagian=tagihan');
  const sheet = billSheet(page);
  await openUntil(
    () => body(page, B).first(),
    sheet,
    sheet.getByRole('textbox', { name: 'Perkiraan nominal' }),
  );
  await sheet.getByRole('button', { name: 'Arsipkan tagihan' }).click();
  const dialog = page.getByRole('alertdialog', { name: `Arsipkan tagihan ${B}?` });
  await expect(dialog.getByRole('button', { name: 'Kembali' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Kembali' }).click();
  await expect(dialog).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Arsipkan tagihan' }).click();
  await dialog.getByRole('button', { name: 'Arsipkan tagihan', exact: true }).click();
  await expect(toasts(page).getByText(`Tagihan ${B} diarsipkan · Pribadi`)).toBeVisible();
  await expectFocusKept(page);
  const arsip = main(page).locator('details');
  await expect(arsip).toContainText(/Tagihan diarsipkan \(\d+\)/);
  await arsip.locator('summary').click();
  await expect(arsip).toContainText(B);
  await expect(arsip.getByRole('button')).toHaveCount(0);
  await expect(body(page, B).filter({ has: page.locator('svg') })).toHaveCount(0);
});

test('Bersama: tidak memuat tagihan, kategori, atau dompet Pribadi; axe dan tanpa gulir mendatar', async ({
  page,
}) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/bersama/rencana?bagian=tagihan');
    await expect(main(page)).not.toContainText(A);
    await expect(main(page)).not.toContainText(WALLET);
    await expect(page.locator('body')).not.toContainText(WALLET);
    await noHorizontalScroll(page);
  }
  const sheet = billSheet(page);
  await openUntil(
    () => main(page).getByRole('button', { name: 'Tambah tagihan' }).first(),
    sheet,
    sheet.getByRole('textbox', { name: 'Nama' }),
  );
  await expect(sheet.getByRole('combobox', { name: 'Kategori' })).not.toContainText(KAT_A);
  await expect(sheet.getByRole('combobox', { name: 'Dompet bayar bawaan' })).not.toContainText(
    WALLET,
  );
  await expectNoSeriousViolations(page);
  await page.keyboard.press('Escape');
  await page.goto('/pribadi/rencana?bagian=tagihan');
  await expect(
    main(page)
      .getByRole('region', { name: 'Periode ini' })
      .or(main(page).getByRole('region', { name: 'Berikutnya' }))
      .first(),
  ).toBeVisible();
  await expectNoSeriousViolations(page);
  expect(digits(1)).toBe('1');
});

test('budget JS: rute Rencana (Anggaran dan Tagihan) dan Beranda/Transaksi nyata ≤ 162 kB', async ({
  browser,
  ownerState,
}) => {
  for (const url of [
    '/pribadi/beranda',
    '/pribadi/transaksi',
    '/pribadi/rencana',
    '/pribadi/rencana?bagian=tagihan',
    '/bersama/rencana?bagian=tagihan',
  ]) {
    await expectRouteBudget(browser, ownerState, url);
    const a = test.info().annotations.slice(-2);
    console.log(
      `BUDGET-S9T ${url}: ${a.map((x) => `${x.type} ${x.description ?? ''}`).join(', ')}`,
    );
  }
});
