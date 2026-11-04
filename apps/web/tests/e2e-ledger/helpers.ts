import type { Browser, Locator, Page, Response } from '@playwright/test';
import { routeScripts } from '../e2e/route-scripts';
import { adminQuery, expect, OWNER, test } from './fixtures';

/**
 * Helper bersama spec `e2e:ledger` (S6 `ledger.spec.ts`, S7 `s7.spec.ts`): Catat, Dompet, ruang
 * pemilik, respons rute Bersama (kanari), dan ukuran JS rute.
 */

/** Batas JS muat dingin per rute (ADR 0002); konstanta sama dengan tests/e2e/budget.spec.ts. */
export const BUDGET_KB = 162;

export const RUANG = { pribadi: 'Pribadi', bersama: 'Bersama' } as const;
export type Ruang = keyof typeof RUANG;

/** 1146750 → '1.146.750' (pemisah ribuan Indonesia, tanpa bergantung pada ICU Node). */
export const digits = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export const toasts = (page: Page) => page.getByRole('region', { name: /Notifikasi/ });
export const catatSheet = (page: Page) =>
  page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Nominal' }) });
export const chipsOf = (sheet: Locator) =>
  sheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio');
export const trigger = (page: Page) => page.locator('[data-catat-trigger]:visible');

/** Penghitung klik pointer (event `click` tepercaya dengan `detail > 0`) di dokumen ini. */
export async function startTapCount(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __taps: number; __tapsOn?: boolean };
    w.__taps = 0;
    if (w.__tapsOn) return;
    w.__tapsOn = true;
    document.addEventListener(
      'click',
      (e) => {
        if (e.isTrusted && e.detail > 0) w.__taps += 1;
      },
      true,
    );
  });
}
export const tapCount = (page: Page) =>
  page.evaluate(() => (window as unknown as { __taps: number }).__taps);

/** Buka Catat dengan tombol Catat sampai sheet sebenarnya (bukan placeholder) termuat. */
export async function openCatat(page: Page): Promise<Locator> {
  const sheet = catatSheet(page);
  // Klik sebelum hidrasi selesai tidak membuka sheet: ulangi hanya bila belum ada dialog.
  await expect(async () => {
    if ((await page.getByRole('dialog').count()) === 0) await trigger(page).click();
    await expect(chipsOf(sheet).first()).toBeVisible({ timeout: 2_000 });
  }).toPass();
  return sheet;
}

/**
 * Buka Catat dengan tombol Catat, ketik nominal (ketikan tidak dihitung), isi keterangan bila ada
 * (keyboard), lalu pilih chip; belum menyimpan. Mengembalikan sheet.
 */
export async function openAndFill(
  page: Page,
  { amount, description, chip = 0 }: { amount: number; description?: string; chip?: number },
): Promise<Locator> {
  const sheet = await openCatat(page);
  const nominal = sheet.getByRole('textbox', { name: 'Nominal' });
  await expect(nominal).toBeFocused();
  await page.keyboard.type(String(amount));
  await expect(nominal).toHaveValue(digits(amount));
  if (description !== undefined) {
    await sheet.getByLabel(/Keterangan/).focus();
    await page.keyboard.type(description);
  }
  await chipsOf(sheet).nth(chip).click();
  await expect(chipsOf(sheet).nth(chip)).toHaveAttribute('aria-checked', 'true');
  return sheet;
}

/** Jalur tercepat Catat; mengembalikan jumlah ketukan dari tombol Catat sampai toast. */
export async function catatCepat(
  page: Page,
  args: { amount: number; ruang: Ruang; wallet: string; description?: string },
): Promise<number> {
  await startTapCount(page);
  const sheet = await openAndFill(page, args);
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page).getByText(
      `Tersimpan di ${RUANG[args.ruang]} · Rp ${digits(args.amount)} dari ${args.wallet}`,
    ),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);
  return tapCount(page);
}

/** Escape karakter khusus regex pada teks literal (mis. nama dompet). */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Saldo dompet `wallet` dari layar Dompet ruang itu (bertanda: `−Rp` = negatif). */
export async function walletBalance(page: Page, ruang: Ruang, wallet: string): Promise<number> {
  await page.goto(`/${ruang}/dompet`);
  // Tautan dompet (namanya diawali nama dompet), bukan baris Menunggu reimburse yang menyebutnya.
  const link = page
    .getByRole('main')
    .getByRole('link', { name: new RegExp(`^${escapeRegExp(wallet)} `) });
  const m = /(−?)Rp\s([\d.]+)/.exec(await link.innerText());
  if (!m) throw new Error('saldo tidak terbaca');
  const n = Number((m[2] ?? '').replaceAll('.', ''));
  return m[1] === '−' ? -n : n;
}

/** Tambah dompet operasional lewat layar Dompet (`?tambah=1`), saldo awal hari ini. */
export async function addWallet(page: Page, ruang: Ruang, name: string, opening: number) {
  await page.goto(`/${ruang}/dompet?tambah=1`);
  const sheet = page.getByRole('dialog', { name: /Tambah dompet/ });
  await expect(sheet.getByRole('textbox', { name: 'Nama' })).toBeFocused();
  await sheet.getByRole('textbox', { name: 'Nama' }).fill(name);
  await sheet.getByRole('radio', { name: 'Operasional' }).click();
  await sheet.getByRole('textbox', { name: 'Saldo hari ini' }).fill(String(opening));
  await sheet.getByRole('button', { name: 'Simpan dompet' }).click();
  await expect(
    toasts(page).getByText(`Dompet ${name} ditambahkan di ${RUANG[ruang]}`),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Ruang pemilik (superuser, hanya untuk asersi). */
export async function spaceId(kind: 'personal' | 'shared'): Promise<string> {
  const [row] = await adminQuery<{ sid: string }>(
    `select s.id as sid from auth."user" u
       join app.space_members m on m.user_id = u.id
       join app.spaces s on s.id = m.space_id and s.kind = $2::app.space_kind
      where u.email = $1`,
    [OWNER, kind],
  );
  if (!row) throw new Error('ruang tidak ada');
  return row.sid;
}

/**
 * Teks semua respons GET rute Bersama selama `act` (dokumen dan payload RSC). Respons yang gagal
 * dibaca di browser (prefetch RSC yang dibatalkan saat halaman pindah) tidak lolos sebagai teks
 * kosong: URL itu diminta ulang dengan header permintaan aslinya (cookie sesi sama) dan badannya
 * diperiksa juga; yang tetap gagal masuk `unread` dan pemanggil mewajibkan 0. Pengalihan (3xx)
 * tidak punya badan dan tidak dihitung.
 */
export async function bersamaResponses(
  page: Page,
  act: () => Promise<unknown>,
): Promise<{ bodies: string[]; unread: string[] }> {
  const reads: Promise<{ url: string; body: string | null }>[] = [];
  const onResponse = (r: Response) => {
    const url = new URL(r.url());
    if (r.request().method() !== 'GET' || !url.pathname.startsWith('/bersama')) return;
    if (r.status() >= 300 && r.status() < 400) return;
    const headers = r.request().headers();
    reads.push(
      r.text().then(
        (body) => ({ url: r.url(), body }),
        async () => {
          const again = await page.request.get(r.url(), { headers, maxRedirects: 0 });
          return { url: r.url(), body: again.ok() ? await again.text() : null };
        },
      ),
    );
  };
  page.on('response', onResponse);
  try {
    await act();
    await page.waitForLoadState('networkidle');
  } finally {
    page.off('response', onResponse);
  }
  const all = await Promise.all(reads);
  return {
    bodies: all.flatMap((x) => (x.body === null ? [] : [x.body])),
    unread: all.flatMap((x) => (x.body === null ? [x.url] : [])),
  };
}

/**
 * JS muat dingin rute `url` (konteks baru = cache kosong, sesi pemilik yang sama): anotasi
 * `js-route-kB`/`js-all-kB`, lalu setiap skrip rute terukur dan total ≤ `BUDGET_KB`.
 */
export async function expectRouteBudget(
  browser: Browser,
  ownerState: string,
  url: string,
): Promise<number> {
  const context = await browser.newContext({ storageState: ownerState });
  const page = await context.newPage();
  const response = await page.goto(url);
  if (!response) throw new Error('tidak ada respons dokumen');
  expect(response.status(), url).toBe(200);
  const own = routeScripts(await response.text());
  await page.waitForLoadState('networkidle');
  const sizes = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((e): e is PerformanceResourceTiming => e instanceof PerformanceResourceTiming)
      .filter((e) => new URL(e.name).pathname.endsWith('.js'))
      .map((e) => ({ path: new URL(e.name).pathname, bytes: e.encodedBodySize })),
  );
  await context.close();

  const kB = (n: number) => n / 1024;
  const routeKb = kB(sizes.filter((s) => own.has(s.path)).reduce((a, s) => a + s.bytes, 0));
  const allKb = kB(sizes.reduce((a, s) => a + s.bytes, 0));
  test
    .info()
    .annotations.push(
      { type: 'js-route-kB', description: routeKb.toFixed(1) },
      { type: 'js-all-kB', description: allKb.toFixed(1) },
    );
  const measured = new Set(sizes.map((s) => s.path));
  expect([...own].filter((p) => !measured.has(p))).toEqual([]);
  expect(sizes.filter((s) => own.has(s.path)).every((s) => s.bytes > 0)).toBe(true);
  expect(routeKb).toBeGreaterThan(100);
  expect(routeKb).toBeLessThanOrEqual(BUDGET_KB);
  return routeKb;
}
