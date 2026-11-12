import { fileURLToPath } from 'node:url';
import type { Browser, Locator, Page } from '@playwright/test';
import { adminQuery, expect, test } from './fixtures';
import { spaceId } from './helpers';

/**
 * Screenshot Rencana > Anggaran rincian mode nyata (S10 Task 5, S10-SB1/SB2) untuk design reviewer. Bukan tes regresi:
 * dilewati kecuali `SCREENS=1`. Jalankan sendiri (data kosong dari global-setup):
 * `SCREENS=1 playwright test -c playwright.ledger.config.ts screens-s10-rencana`.
 */
test.skip(process.env.SCREENS !== '1', 'screenshot hanya dengan SCREENS=1');
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const OUT_DIR = fileURLToPath(new URL('../../../../docs/design/s10/', import.meta.url));
const main = (page: Page) => page.getByRole('main');
const WIDTHS = [320, 390, 1280];
const THEMES = ['dark', 'light'] as const;
const LONG_SUB = 'Obat dan Vitamin Bulanan Keluarga Besar';

async function withPage(
  browser: Browser,
  ownerState: string,
  w: number,
  theme: string,
  path: string,
  fn: (p: Page) => Promise<void>,
  name: string,
) {
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
    if (overflow > 0) console.log(`OVERFLOW ${name} ${String(w)} ${theme}: +${String(overflow)}px`);
  } finally {
    await context.close();
  }
}

async function shoot(
  browser: Browser,
  ownerState: string,
  name: string,
  path: string,
  fn: (p: Page) => Promise<void>,
) {
  for (const theme of THEMES)
    for (const w of WIDTHS) await withPage(browser, ownerState, w, theme, path, fn, name);
}

async function openUntil(open: () => Locator, sheet: Locator, field: Locator) {
  await expect(async () => {
    if ((await sheet.count()) === 0) await open().click();
    await expect(field).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

const sheetOf = (p: Page) =>
  p.getByRole('dialog', { name: /^Anggaran( rincian)?\s*(Pribadi|Bersama)$/ });
const row = (p: Page, name: string) =>
  main(p).locator('[data-budget-row]').filter({ hasText: name });
const amountOf = (s: Locator) => s.getByRole('textbox', { name: 'Anggaran periode ini' });

test('data: induk beranggaran, dua rincian (satu bernama panjang), satu kandidat', async () => {
  const sid = await spaceId('personal');
  const month = '(select label_month from app.pay_period($1, app.today()))';
  await adminQuery(
    `insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by)
     select $1, c.id, ${month}, 750000, false, u.id
       from app.categories c, auth."user" u where c.space_id = $1 and c.name = 'Kesehatan' limit 1`,
    [sid],
  );
  const [kes] = await adminQuery<{ id: string }>(
    "select id::text from app.categories where space_id = $1 and name = 'Kesehatan'",
    [sid],
  );
  for (const [name, amount] of [
    ['Dokter Gigi', 300_000],
    [LONG_SUB, 200_000],
    ['Cek Lab', null],
  ] as const) {
    await adminQuery(
      `insert into app.categories (space_id, parent_id, type, name, icon) values ($1, $2, 'expense', $3, 'Receipt')`,
      [sid, kes?.id, name],
    );
    if (amount !== null)
      await adminQuery(
        `insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by)
         select $1, c.id, ${month}, $3, false, u.id
           from app.categories c, auth."user" u where c.space_id = $1 and c.name = $2 limit 1`,
        [sid, name, amount],
      );
  }
});

test('S10-SB1 daftar Anggaran dengan rincian', async ({ browser, ownerState }) => {
  await shoot(browser, ownerState, 'sb1-daftar-rincian', '/pribadi/rencana', async (p) => {
    await expect(main(p).getByRole('list', { name: 'Rincian Kesehatan' })).toBeVisible();
  });
});

test('S10-SB2 sheet rincian (baru, ubah) dan sheet induk dengan rincian', async ({
  browser,
  ownerState,
}) => {
  await shoot(browser, ownerState, 'sb2-sheet-rincian-baru', '/pribadi/rencana', async (p) => {
    const sheet = sheetOf(p);
    await openUntil(
      () => main(p).getByRole('button', { name: 'Tambah rincian untuk Kesehatan' }),
      sheet,
      amountOf(sheet),
    );
    await sheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: 'Cek Lab' });
  });
  await shoot(browser, ownerState, 'sb2-sheet-rincian-ubah', '/pribadi/rencana', async (p) => {
    const sheet = sheetOf(p);
    await openUntil(() => row(p, 'Dokter Gigi'), sheet, amountOf(sheet));
  });
  await shoot(browser, ownerState, 'sb2-sheet-induk', '/pribadi/rencana', async (p) => {
    const sheet = sheetOf(p);
    await openUntil(() => row(p, 'Kesehatan').first(), sheet, amountOf(sheet));
  });
});

test('S10-RV1 Review bulanan (periode berjalan: Rencana vs kenyataan, kartu Siapkan)', async ({
  browser,
  ownerState,
}) => {
  await shoot(browser, ownerState, 'rv1-review', '/pribadi/rencana/review', async (p) => {
    await expect(main(p).getByRole('region', { name: 'Rencana vs kenyataan' })).toBeVisible();
    await expect(main(p).getByRole('region', { name: /^Siapkan / })).toBeVisible();
  });
});

test('S10-EX1 Laporan dengan tombol Ekspor CSV', async ({ browser, ownerState }) => {
  await shoot(browser, ownerState, 'ex1-laporan-ekspor', '/pribadi/laporan', async (p) => {
    await expect(main(p).getByRole('link', { name: 'Ekspor CSV' })).toBeVisible();
  });
});
