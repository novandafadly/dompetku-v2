import { fileURLToPath } from 'node:url';
import type { Browser, Locator, Page } from '@playwright/test';
import { adminQuery, expect, test } from './fixtures';
import { addWallet, spaceId, toasts } from './helpers';

/**
 * Screenshot Rencana > Tagihan mode nyata (S9 Task 11) untuk design reviewer. Bukan tes regresi:
 * dilewati kecuali `SCREENS=1`. Jalankan sendiri (data kosong dari global-setup):
 * `SCREENS=1 playwright test -c playwright.ledger.config.ts screens-s9-tagihan`.
 */
test.skip(process.env.SCREENS !== '1', 'screenshot hanya dengan SCREENS=1');
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const OUT_DIR = fileURLToPath(new URL('../../../../docs/design/s9/', import.meta.url));
const main = (page: Page) => page.getByRole('main');
const WIDTHS = [320, 390, 768, 1280];
const THEMES = ['dark', 'light'] as const;

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

const billSheet = (p: Page) =>
  p.getByRole('dialog', { name: /^(Tagihan|Ubah tagihan)\s*(Pribadi|Bersama)$/ });
const paySheet = (p: Page) => p.getByRole('dialog', { name: /^Bayar .+\s(Pribadi|Bersama)$/ });
const body = (p: Page, name: string) =>
  main(p).locator('[data-bill-row]').filter({ hasText: name }).first();
const BILLS = [
  { name: 'Cicilan Motor', amount: 1_250_000, kategori: 'Cicilan & Tagihan', day: 1 },
  { name: 'Netflix', amount: 54_000, kategori: 'Langganan', day: 3 },
  { name: 'Tagihan Kartu Kredit', amount: 2_340_000, kategori: 'Cicilan & Tagihan', day: 12 },
  { name: 'Spotify', amount: 55_000, kategori: 'Langganan', day: 20 },
];
const LONG = 'Cicilan Renovasi Rumah Orang Tua di Kampung Halaman Tahap Kedua';
const WALLET = 'BCA';

async function today(): Promise<string> {
  const [r] = await adminQuery<{ iso: string }>("select to_char(app.today(),'YYYY-MM-DD') as iso");
  return r?.iso ?? '';
}

test('data: dompet BCA, empat tagihan (satu lewat jatuh tempo), satu dibayar, satu diarsipkan', async ({
  page,
}) => {
  await addWallet(page, 'pribadi', WALLET, 8_000_000);
  const iso = await today();
  for (const b of [
    ...BILLS,
    { name: 'Arsip Lama', amount: 99_000, kategori: 'Langganan', day: 5 },
  ]) {
    await page.goto('/pribadi/rencana?bagian=tagihan');
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
    await sheet.getByLabel('Mulai').fill(`${iso.slice(0, 7)}-01`);
    await sheet.getByRole('button', { name: 'Simpan tagihan' }).click();
    await expect(toasts(page).getByText(`Tagihan ${b.name} disimpan · Pribadi`)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  // Netflix dibayar (Lunas), Arsip Lama diarsipkan.
  await page.goto('/pribadi/rencana?bagian=tagihan');
  const pay = paySheet(page);
  await openUntil(
    () =>
      main(page)
        .getByRole('button', { name: /^Bayar Netflix, Rp/ })
        .first(),
    pay,
    pay.getByRole('textbox', { name: 'Nominal' }),
  );
  await pay.getByRole('button', { name: /^Bayar Rp/ }).click();
  await expect(toasts(page).getByText(/Tagihan Netflix dibayar/)).toBeVisible();
  const edit = billSheet(page);
  await openUntil(
    () => body(page, 'Arsip Lama'),
    edit,
    edit.getByRole('button', { name: 'Arsipkan tagihan' }),
  );
  await edit.getByRole('button', { name: 'Arsipkan tagihan' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Arsipkan tagihan', exact: true })
    .click();
  await expect(toasts(page).getByText('Tagihan Arsip Lama diarsipkan · Pribadi')).toBeVisible();
});

test('stres: nama 60 huruf dan nominal Rp 12.345.678.900 (bukan untuk portofolio)', async ({
  browser,
  ownerState,
}) => {
  const sid = await spaceId('personal');
  await adminQuery(
    `update app.bills set name = $2, amount = 12345678900 where space_id = $1 and name = 'Tagihan Kartu Kredit'`,
    [sid, LONG.slice(0, 60)],
  );
  await adminQuery(
    `update app.bill_occurrences o set amount = 12345678900 from app.bills b
      where o.bill_id = b.id and b.space_id = $1 and b.name = $2 and o.entry_id is null`,
    [sid, LONG.slice(0, 60)],
  );
  for (const theme of THEMES)
    for (const w of [320, 390])
      await withPage(
        browser,
        ownerState,
        w,
        theme,
        '/pribadi/rencana?bagian=tagihan',
        async (p) => {
          await expect(main(p).getByRole('region', { name: 'Periode ini' })).toBeVisible();
        },
        'stres-tg1-panjang',
      );
  await adminQuery(
    `update app.bills set name = 'Tagihan Kartu Kredit', amount = 2340000 where space_id = $1 and name = $2`,
    [sid, LONG.slice(0, 60)],
  );
  await adminQuery(
    `update app.bill_occurrences o set amount = 2340000 from app.bills b
      where o.bill_id = b.id and b.space_id = $1 and b.name = 'Tagihan Kartu Kredit' and o.entry_id is null`,
    [sid],
  );
});

test('S9-TG1 daftar Tagihan Pribadi dan RC0 Bersama kosong', async ({ browser, ownerState }) => {
  await shoot(browser, ownerState, 'tg1-pribadi', '/pribadi/rencana?bagian=tagihan', async (p) => {
    await expect(main(p).getByRole('region', { name: 'Periode ini' })).toBeVisible();
  });
  await shoot(browser, ownerState, 'tg1-rc0-bersama', '/bersama/rencana', async (p) => {
    await expect(
      main(p).getByRole('heading', { name: 'Belum ada rencana di Bersama.' }),
    ).toBeVisible();
  });
});

test('S9-TG2 sheet Tambah dan Ubah, galat kewajiban ganda, dialog Arsip', async ({
  browser,
  ownerState,
}) => {
  await shoot(
    browser,
    ownerState,
    'tg2-sheet-tambah',
    '/pribadi/rencana?bagian=tagihan',
    async (p) => {
      const s = billSheet(p);
      await openUntil(
        () => main(p).getByRole('button', { name: 'Tambah tagihan' }).first(),
        s,
        s.getByRole('textbox', { name: 'Nama' }),
      );
    },
  );
  await shoot(
    browser,
    ownerState,
    'tg2-sheet-ubah',
    '/pribadi/rencana?bagian=tagihan',
    async (p) => {
      const s = billSheet(p);
      await openUntil(
        () => body(p, 'Cicilan Motor'),
        s,
        s.getByRole('textbox', { name: 'Perkiraan nominal' }),
      );
    },
  );
  await shoot(
    browser,
    ownerState,
    'tg2-dialog-arsip',
    '/pribadi/rencana?bagian=tagihan',
    async (p) => {
      const s = billSheet(p);
      await openUntil(
        () => body(p, 'Cicilan Motor'),
        s,
        s.getByRole('button', { name: 'Arsipkan tagihan' }),
      );
      await s.getByRole('button', { name: 'Arsipkan tagihan' }).click();
      await expect(p.getByRole('alertdialog')).toBeVisible();
    },
  );
  const sid = await spaceId('personal');
  await adminQuery(
    `insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by)
     select $1, c.id, (select label_month from app.pay_period($1, app.today())), 700000, true, u.id
       from app.categories c, auth."user" u where c.space_id = $1 and c.name = 'Hiburan' limit 1`,
    [sid],
  );
  const iso = await today();
  await shoot(
    browser,
    ownerState,
    'tg2-galat-obligation',
    '/pribadi/rencana?bagian=tagihan',
    async (p) => {
      const s = billSheet(p);
      await openUntil(
        () => main(p).getByRole('button', { name: 'Tambah tagihan' }).first(),
        s,
        s.getByRole('textbox', { name: 'Nama' }),
      );
      await s.getByRole('textbox', { name: 'Nama' }).fill('Bioskop Bulanan');
      await s.getByRole('textbox', { name: 'Perkiraan nominal' }).fill('100000');
      await s.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: 'Hiburan' });
      await s.getByRole('combobox', { name: 'Tanggal tiap bulan' }).selectOption('1');
      await s.getByLabel('Mulai').fill(`${iso.slice(0, 7)}-01`);
      await s.getByRole('button', { name: 'Simpan tagihan' }).click();
      await expect(s.getByText(/sudah punya anggaran wajib/)).toBeVisible();
    },
  );
  await adminQuery(`delete from app.budgets where space_id = $1`, [sid]);
});

test('S9-TG3 sheet Bayar, peringatan saldo kurang, tanpa dompet', async ({
  browser,
  ownerState,
}) => {
  await shoot(
    browser,
    ownerState,
    'tg3-sheet-bayar',
    '/pribadi/rencana?bagian=tagihan',
    async (p) => {
      const s = paySheet(p);
      await openUntil(
        () => main(p).getByRole('button', { name: /^Bayar Cicilan Motor, Rp/ }),
        s,
        s.getByRole('textbox', { name: 'Nominal' }),
      );
      await s.getByRole('textbox', { name: 'Nominal' }).fill('1275000');
    },
  );
  // Saldo BCA dikecilkan sementara supaya peringatan muncul.
  const sid = await spaceId('personal');
  await shoot(
    browser,
    ownerState,
    'tg3-saldo-kurang',
    '/pribadi/rencana?bagian=tagihan',
    async (p) => {
      const s = paySheet(p);
      await openUntil(
        () => main(p).getByRole('button', { name: /^Bayar Tagihan Kartu Kredit, Rp/ }),
        s,
        s.getByRole('textbox', { name: 'Nominal' }),
      );
      await s.getByRole('textbox', { name: 'Nominal' }).fill('9000000');
      await s.getByRole('button', { name: /^Bayar Rp/ }).click();
      await expect(s.getByRole('status')).toContainText('Kalau dibayar');
    },
  );
  expect(sid).not.toBe('');
});
