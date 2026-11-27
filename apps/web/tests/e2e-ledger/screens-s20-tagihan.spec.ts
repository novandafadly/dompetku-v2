import { fileURLToPath } from 'node:url';
import type { Browser, Locator, Page } from '@playwright/test';
import { adminQuery, expect, test } from './fixtures';
import { addWallet, toasts } from './helpers';

/**
 * Screenshot periode tagihan (S20) untuk Delivery Gate. Bukan tes regresi: dilewati kecuali
 * `SCREENS=1`. Jalankan sendiri (data kosong dari global-setup):
 * `SCREENS=1 playwright test -c playwright.ledger.config.ts screens-s20-tagihan`.
 */
test.skip(process.env.SCREENS !== '1', 'screenshot hanya dengan SCREENS=1');
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const OUT_DIR = fileURLToPath(new URL('../../../../docs/design/s20/', import.meta.url));
const main = (page: Page) => page.getByRole('main');
const WIDTHS = [320, 390, 1280];
const THEMES = ['dark', 'light'] as const;
const billSheet = (p: Page) =>
  p.getByRole('dialog', { name: /^(Tambah tagihan|Ubah tagihan)\s*(Pribadi|Bersama)$/ });
const body = (p: Page, name: string) =>
  main(p).locator('[data-bill-row]').filter({ hasText: name }).first();

const LONG = 'Arisan Keluarga Besar Setiap Dua Minggu di Rumah Nenek Kampung';
const BILLS = [
  { name: 'Listrik PLN', amount: 485_000, unit: 'month:1', day: 10 },
  { name: 'Arisan RT', amount: 50_000, unit: 'week:2', day: 1 },
  { name: LONG, amount: 150_000, unit: 'week:1', day: 1 },
  { name: 'PBB', amount: 700_000, unit: 'month:2', day: 28 },
  { name: 'Asuransi Tahunan', amount: 4_800_000, unit: 'month:12', day: 28 },
];

async function openUntil(open: () => Locator, sheet: Locator, field: Locator) {
  await expect(async () => {
    if ((await sheet.count()) === 0) await open().click();
    await expect(field).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

async function today(): Promise<string> {
  const [r] = await adminQuery<{ iso: string }>("select to_char(app.today(),'YYYY-MM-DD') as iso");
  return r?.iso ?? '';
}

async function shoot(
  browser: Browser,
  ownerState: string,
  name: string,
  fn: (p: Page) => Promise<void>,
) {
  for (const theme of THEMES) {
    for (const w of WIDTHS) {
      const context = await browser.newContext({
        storageState: ownerState,
        viewport: { width: w, height: w === 1280 ? 800 : w === 320 ? 640 : 844 },
        reducedMotion: 'reduce',
        baseURL: 'http://localhost:3301',
      });
      const page = await context.newPage();
      try {
        await page.goto(`/pribadi/rencana?bagian=tagihan&theme=${theme}`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await fn(page);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
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

test('data: dompet dan lima tagihan dengan periode berbeda', async ({ page }) => {
  await addWallet(page, 'pribadi', 'BCA', 8_000_000);
  const iso = await today();
  for (const b of BILLS) {
    await page.goto('/pribadi/rencana?bagian=tagihan');
    const sheet = billSheet(page);
    await openUntil(
      () => main(page).getByRole('button', { name: 'Tambah tagihan' }).first(),
      sheet,
      sheet.getByRole('textbox', { name: 'Nama' }),
    );
    await sheet.getByRole('textbox', { name: 'Nama' }).fill(b.name);
    await sheet.getByRole('textbox', { name: 'Perkiraan nominal' }).fill(String(b.amount));
    await sheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: 'Langganan' });
    await sheet.getByRole('combobox', { name: 'Ulangi' }).selectOption(b.unit);
    if (b.unit.startsWith('month')) {
      await sheet.getByRole('combobox', { name: 'Tanggal tiap bulan' }).selectOption(String(b.day));
    }
    await sheet.getByLabel('Mulai').fill(`${iso.slice(0, 7)}-01`);
    await sheet.getByRole('button', { name: 'Simpan tagihan' }).click();
    await expect(toasts(page).getByText(`Tagihan ${b.name} disimpan · Pribadi`)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

test('S20-1 daftar Tagihan dengan ritme di sub baris', async ({ browser, ownerState }) => {
  await shoot(browser, ownerState, 's20-1-daftar', async (p) => {
    await expect(body(p, 'Arisan RT')).toBeVisible();
  });
});

test('S20-2 sheet Tambah: bulanan bawaan, mingguan, tiap 2 bulan', async ({
  browser,
  ownerState,
}) => {
  const open = async (p: Page) => {
    const s = billSheet(p);
    await openUntil(
      () => main(p).getByRole('button', { name: 'Tambah tagihan' }).first(),
      s,
      s.getByRole('textbox', { name: 'Nama' }),
    );
    return s;
  };
  await shoot(browser, ownerState, 's20-2a-tambah-bulanan', async (p) => {
    await open(p);
  });
  await shoot(browser, ownerState, 's20-2b-tambah-mingguan', async (p) => {
    const s = await open(p);
    await s.getByRole('combobox', { name: 'Ulangi' }).selectOption('week:2');
    await expect(s.getByText(/^Jatuh tempo tiap /)).toBeVisible();
  });
  await shoot(browser, ownerState, 's20-2c-tambah-dua-bulan', async (p) => {
    const s = await open(p);
    await s.getByRole('combobox', { name: 'Ulangi' }).selectOption('month:2');
    await expect(s.getByText(/^Jatuh tempo pertama bulan /)).toBeVisible();
  });
});

test('S20-3 sheet Ubah: periode baca-saja (mingguan dan nama panjang)', async ({
  browser,
  ownerState,
}) => {
  for (const [slug, name] of [
    ['mingguan', 'Arisan RT'],
    ['nama-panjang', LONG],
  ] as const) {
    await shoot(browser, ownerState, `s20-3-ubah-${slug}`, async (p) => {
      const s = billSheet(p);
      await openUntil(
        () => body(p, name),
        s,
        s.getByRole('textbox', { name: 'Perkiraan nominal' }),
      );
      await expect(s.getByText(/^Tiap (2 )?minggu · /)).toBeVisible();
    });
  }
});
