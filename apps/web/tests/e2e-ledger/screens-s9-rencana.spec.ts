import { fileURLToPath } from 'node:url';
import type { Browser, Locator, Page } from '@playwright/test';
import { adminQuery, expect, test } from './fixtures';
import { addWallet, chipsOf, openCatat, spaceId, toasts } from './helpers';

/**
 * Screenshot Rencana > Anggaran mode nyata (S9 Task 10) untuk design reviewer. Bukan tes regresi:
 * dilewati kecuali `SCREENS=1`. Jalankan sendiri (data kosong dari global-setup):
 * `SCREENS=1 playwright test -c playwright.ledger.config.ts screens-s9-rencana`.
 */
test.skip(process.env.SCREENS !== '1', 'screenshot hanya dengan SCREENS=1');
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const OUT_DIR = fileURLToPath(new URL('../../../../docs/design/s9/', import.meta.url));
const main = (page: Page) => page.getByRole('main');
const WIDTHS = [320, 390, 768, 1280];
const THEMES = ['dark', 'light'] as const;
const LONG = 'Kebutuhan Bulanan Keluarga Besar';

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

const sheetOf = (p: Page) => p.getByRole('dialog', { name: /^Anggaran\s*(Pribadi|Bersama)$/ });
const row = (p: Page, name: string) =>
  main(p).locator('[data-budget-row]').filter({ hasText: name });
const amountOf = (s: Locator) => s.getByRole('textbox', { name: 'Anggaran periode ini' });

let spent = '';

test('data: dompet, dua pengeluaran, anggaran bernama panjang dan nominal besar', async ({
  page,
}) => {
  await addWallet(page, 'pribadi', 'BCA', 5_000_000);
  await page.goto('/pribadi/beranda');
  for (const amount of [850_000, 300_000]) {
    const sheet = await openCatat(page);
    await page.keyboard.type(String(amount));
    spent = ((await chipsOf(sheet).first().innerText()) || '').trim();
    await chipsOf(sheet).first().click();
    await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect(
      toasts(page)
        .getByText(/Tersimpan di Pribadi/)
        .last(),
    ).toBeVisible();
    await expect(sheet).toHaveCount(0);
  }
  const sid = await spaceId('personal');
  await adminQuery('update app.categories set name = $2 where space_id = $1 and name = $3', [
    sid,
    LONG,
    'Hiburan',
  ]);
  const ins = (name: string, amount: number, wajib: boolean) =>
    adminQuery(
      `insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by)
       select $1, c.id, (select label_month from app.pay_period($1, app.today())), $3, $4, u.id
         from app.categories c, auth."user" u where c.space_id = $1 and c.name = $2 limit 1`,
      [sid, name, amount, wajib],
    );
  expect(spent).not.toBe('');
  await ins(spent.split('\n')[0] ?? '', 1_200_000, true);
  await ins(LONG, 3_000_000, false);
  await ins('Kesehatan', 750_000, false);
});

test('stres: nominal sangat panjang (bukan untuk portofolio)', async ({ browser, ownerState }) => {
  const sid = await spaceId('personal');
  await adminQuery(
    `update app.budgets set amount = 12345678900
      where space_id = $1 and category_id = (select id from app.categories where space_id = $1 and name = $2)`,
    [sid, LONG],
  );
  for (const theme of THEMES)
    for (const w of [320, 390])
      await withPage(
        browser,
        ownerState,
        w,
        theme,
        '/pribadi/rencana',
        async (p) => {
          await expect(
            main(p).getByRole('region', { name: 'Dianggarkan', exact: true }),
          ).toBeVisible();
        },
        'stres-an1-nominal-panjang',
      );
  await adminQuery(
    `update app.budgets set amount = 3000000
      where space_id = $1 and category_id = (select id from app.categories where space_id = $1 and name = $2)`,
    [sid, LONG],
  );
});

test('Pribadi kosong (S9-RC0) dan terisi (S9-AN1)', async ({ browser, ownerState }) => {
  // Terisi lebih dulu (data sudah ada); kosong dipotret pada Bersama di bawah.
  await shoot(browser, ownerState, 'an1-pribadi-terisi', '/pribadi/rencana', async (p) => {
    await expect(main(p).getByRole('region', { name: 'Dianggarkan', exact: true })).toBeVisible();
  });
  await shoot(browser, ownerState, 'rc0-bersama-kosong', '/bersama/rencana', async (p) => {
    await expect(
      main(p).getByRole('heading', { name: 'Belum ada rencana di Bersama.' }),
    ).toBeVisible();
  });
});

test('sheet Atur anggaran (kosong, ubah) dan dialog Hapus', async ({ browser, ownerState }) => {
  await shoot(browser, ownerState, 'an2-sheet-kosong', '/pribadi/rencana', async (p) => {
    const sheet = sheetOf(p);
    await openUntil(
      () => main(p).getByRole('button', { name: 'Atur anggaran' }).last(),
      sheet,
      amountOf(sheet),
    );
  });
  await shoot(browser, ownerState, 'an2-sheet-ubah', '/pribadi/rencana', async (p) => {
    const sheet = sheetOf(p);
    await openUntil(() => row(p, LONG), sheet, amountOf(sheet));
  });
  await shoot(browser, ownerState, 'an2-dialog-hapus', '/pribadi/rencana', async (p) => {
    const sheet = sheetOf(p);
    await openUntil(() => row(p, 'Kesehatan'), sheet, amountOf(sheet));
    await sheet.getByRole('button', { name: 'Hapus anggaran' }).click();
    await expect(p.getByRole('alertdialog')).toBeVisible();
  });
});

test('Bersama: galat obligation_double dan periode baru dengan Salin', async ({
  browser,
  ownerState,
}) => {
  const sid = await spaceId('shared');
  const listrik = (
    await adminQuery<{ id: string }>(
      "select id::text from app.categories where space_id = $1 and name = 'Listrik & Air'",
      [sid],
    )
  )[0]?.id;
  await adminQuery(
    `insert into app.bills (space_id, name, amount, category_id, day_of_month, starts_on, created_by)
     select $1, 'Listrik PLN', 485000, $2, 5, app.today() - 40, u.id from auth."user" u limit 1`,
    [sid, listrik],
  );
  await shoot(
    browser,
    ownerState,
    'an2-galat-obligation-bersama',
    '/bersama/rencana',
    async (p) => {
      const sheet = sheetOf(p);
      await openUntil(
        () => main(p).getByRole('button', { name: 'Atur anggaran pertama' }),
        sheet,
        amountOf(sheet),
      );
      await sheet
        .getByRole('combobox', { name: 'Kategori' })
        .selectOption({ label: 'Listrik & Air' });
      await amountOf(sheet).fill('500000');
      await sheet.getByRole('switch', { name: 'Wajib' }).click();
      await sheet.getByRole('button', { name: 'Simpan anggaran' }).click();
      await expect(sheet.getByText(/sudah punya tagihan Listrik PLN/)).toBeVisible();
    },
  );
  for (const [name, wajib] of [
    ['Sewa Rumah', true],
    ['Listrik & Air', true],
    ['Internet', false],
  ] as const) {
    await adminQuery(
      `insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by)
       select $1, c.id, (select (label_month - interval '1 month')::date from app.pay_period($1, app.today())), 300000, $3, u.id
         from app.categories c, auth."user" u where c.space_id = $1 and c.name = $2 limit 1`,
      [sid, name, wajib],
    );
  }
  await shoot(browser, ownerState, 'an1-bersama-periode-baru', '/bersama/rencana', async (p) => {
    await expect(
      main(p).getByRole('button', { name: 'Salin anggaran periode lalu' }),
    ).toBeVisible();
  });
});
