import { fileURLToPath } from 'node:url';
import type { Browser, Locator, Page } from '@playwright/test';
import { adminQuery, expect, test } from './fixtures';
import { addWallet, chipsOf, openCatat, toasts } from './helpers';

/**
 * Screenshot Beranda mode nyata (S9 Task 12, S9-BR1/BR2) untuk design reviewer dan portofolio.
 * Bukan tes regresi: dilewati kecuali `SCREENS=1`. Jalankan sendiri (data kosong dari global-setup):
 * `SCREENS=1 playwright test -c playwright.ledger.config.ts screens-s9-beranda`. Data wajar, tanpa
 * nominal ekstrem; halaman penuh supaya kartu di bawah lipatan ikut terlihat.
 */
test.skip(process.env.SCREENS !== '1', 'screenshot hanya dengan SCREENS=1');
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const OUT_DIR = fileURLToPath(new URL('../../../../docs/design/s9/', import.meta.url));
const main = (page: Page) => page.getByRole('main');
const WIDTHS = [320, 390, 768, 1280];
const THEMES = ['dark', 'light'] as const;

async function shoot(
  browser: Browser,
  ownerState: string,
  path: string,
  name: string,
  ready: (p: Page) => Promise<void>,
) {
  for (const theme of THEMES) {
    for (const w of WIDTHS) {
      const context = await browser.newContext({
        storageState: ownerState,
        viewport: { width: w, height: w === 1280 ? 800 : w === 768 ? 1000 : w === 320 ? 640 : 844 },
        reducedMotion: 'reduce',
        baseURL: 'http://localhost:3301',
      });
      const page = await context.newPage();
      try {
        await page.goto(`${path}?theme=${theme}`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await ready(page);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        // Halaman penuh tanpa artefak: viewport disetel setinggi dokumen (dua kali, karena tinggi
        // bisa berubah sesudah ukuran berubah) sehingga bilah tab bawah (fixed) berada di dasar
        // halaman dan sidebar laptop setinggi halaman, bukan terpotong di tengah gambar.
        for (let i = 0; i < 2; i += 1) {
          const h = await page.evaluate(() => document.documentElement.scrollHeight);
          await page.setViewportSize({ width: w, height: h });
          await page.waitForTimeout(250);
        }
        await page.screenshot({
          path: `${OUT_DIR}${name}-${String(w)}-${theme}.png`,
          animations: 'disabled',
        });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (overflow > 0)
          console.log(`OVERFLOW ${name} ${String(w)} ${theme}: +${String(overflow)}px`);
      } finally {
        await context.close();
      }
    }
  }
}

async function openUntil(open: () => Locator, sheet: Locator, field: Locator) {
  await expect(async () => {
    if ((await sheet.count()) === 0) await open().click();
    await expect(field).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

const billSheet = (p: Page) =>
  p.getByRole('dialog', { name: /^(Tagihan|Ubah tagihan)\s*(Pribadi|Bersama)$/ });
const budgetSheet = (p: Page) => p.getByRole('dialog', { name: /^Anggaran\s*(Pribadi|Bersama)$/ });
const ruangName = { pribadi: 'Pribadi', bersama: 'Bersama' } as const;

async function today(): Promise<{ iso: string; day: number }> {
  const [r] = await adminQuery<{ iso: string; day: number }>(
    "select to_char(app.today(),'YYYY-MM-DD') as iso, extract(day from app.today())::int as day",
  );
  if (!r) throw new Error('today');
  return r;
}

async function addBill(
  page: Page,
  ruang: 'pribadi' | 'bersama',
  b: { name: string; amount: number; kategori: string; day: number },
) {
  const t = await today();
  await page.goto(`/${ruang}/rencana?bagian=tagihan`);
  const sheet = billSheet(page);
  await openUntil(
    () => main(page).getByRole('button', { name: 'Tambah tagihan' }).first(),
    sheet,
    sheet.getByRole('textbox', { name: 'Nama' }),
  );
  await sheet.getByRole('textbox', { name: 'Nama' }).fill(b.name);
  await sheet.getByRole('textbox', { name: 'Perkiraan nominal' }).fill(String(b.amount));
  await sheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: b.kategori });
  await sheet.getByRole('combobox', { name: 'Tanggal tiap bulan' }).selectOption(String(b.day));
  await sheet.getByLabel('Mulai').fill(`${t.iso.slice(0, 7)}-01`);
  await sheet.getByRole('button', { name: 'Simpan tagihan' }).click();
  await expect(
    toasts(page).getByText(`Tagihan ${b.name} disimpan · ${ruangName[ruang]}`),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function expense(page: Page, amount: number, chip: number): Promise<string> {
  await page.goto('/pribadi/beranda');
  const sheet = await openCatat(page);
  await page.keyboard.type(String(amount));
  const c = chipsOf(sheet).nth(chip);
  const name = ((await c.innerText()) || '').trim().split('\n')[0] ?? '';
  await c.click();
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page)
      .getByText(/Tersimpan di Pribadi/)
      .last(),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);
  return name;
}

async function setBudget(page: Page, kategori: string, amount: number, wajib: boolean) {
  await page.goto('/pribadi/rencana');
  const sheet = budgetSheet(page);
  await openUntil(
    () =>
      main(page)
        .getByRole('button', { name: /^Atur anggaran/ })
        .first(),
    sheet,
    sheet.getByRole('textbox', { name: 'Anggaran periode ini' }),
  );
  await sheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: kategori });
  await sheet.getByRole('textbox', { name: 'Anggaran periode ini' }).fill(String(amount));
  if (wajib) await sheet.getByRole('switch', { name: 'Wajib' }).click();
  await sheet.getByRole('button', { name: 'Simpan anggaran' }).click();
  await expect(toasts(page).getByText(`Anggaran ${kategori} disimpan · Pribadi`)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

const card = (p: Page) => p.getByTestId('balance-card');
const cards = async (p: Page) => {
  await expect(card(p)).toBeVisible();
  await expect(main(p).getByRole('region', { name: 'Tagihan 7 hari' })).toBeVisible();
  await expect(main(p).getByRole('region', { name: 'Anggaran hampir habis' })).toBeVisible();
};

test('data Pribadi: dompet BCA, dua anggaran dekat batas, dua tagihan mendatang', async ({
  page,
}) => {
  const t = await today();
  await addWallet(page, 'pribadi', 'BCA', 8_000_000);
  const k1 = await expense(page, 850_000, 0);
  const k2 = await expense(page, 410_000, 1);
  await setBudget(page, k1, 1_000_000, true);
  await setBudget(page, k2, 500_000, false);
  const soon = (n: number) => Math.min(t.day + n, 28);
  await addBill(page, 'pribadi', {
    name: 'Netflix',
    amount: 54_000,
    kategori: 'Langganan',
    day: soon(2),
  });
  await addBill(page, 'pribadi', {
    name: 'Listrik PLN',
    amount: 485_000,
    kategori: 'Cicilan & Tagihan',
    day: soon(5),
  });
});

test('S9-BR1/BR2 Aman dengan tagihan dan wajib', async ({ browser, ownerState }) => {
  await shoot(browser, ownerState, '/pribadi/beranda', 'br1-aman', cards);
});

test('S9-BR1 Hati-hati: tagihan lewat jatuh tempo', async ({ page, browser, ownerState }) => {
  test.skip((await today()).day === 1, 'tanggal 1: tidak ada tagihan lewat');
  await addBill(page, 'pribadi', {
    name: 'Cicilan Motor',
    amount: 1_250_000,
    kategori: 'Cicilan & Tagihan',
    day: 1,
  });
  await shoot(browser, ownerState, '/pribadi/beranda', 'br1-hati-hati', cards);
});

test('S9-BR1 Lewat batas: kewajiban melebihi saldo', async ({ page, browser, ownerState }) => {
  test.skip((await today()).day === 1, 'tanggal 1: tidak ada tagihan lewat');
  await addBill(page, 'pribadi', {
    name: 'Cicilan Kendaraan',
    amount: 9_500_000,
    kategori: 'Cicilan & Tagihan',
    day: 1,
  });
  await shoot(browser, ownerState, '/pribadi/beranda', 'br1-lewat-batas', cards);
});

test('S9-BR2 Bersama: tagihan listrik, anggaran kosong', async ({ page, browser, ownerState }) => {
  const t = await today();
  await addWallet(page, 'bersama', 'Dompet Bersama', 3_000_000);
  await addBill(page, 'bersama', {
    name: 'Listrik PLN',
    amount: 612_000,
    kategori: 'Listrik & Air',
    day: Math.min(t.day + 3, 28),
  });
  await shoot(browser, ownerState, '/bersama/beranda', 'br2-bersama', cards);
});
