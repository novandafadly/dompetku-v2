import { fileURLToPath } from 'node:url';
import type { Browser, Locator, Page } from '@playwright/test';
import { adminQuery, expect, test } from './fixtures';
import { addWallet, chipsOf, digits, openCatat, toasts } from './helpers';

/**
 * Screenshot layar S7 mode nyata untuk design critique (Task 18): Detail antar ruang, talangan +
 * reimburse, Pindahkan, banner dipindah, Cocokkan saldo, Arsipkan, Dompet dengan Menunggu
 * reimburse, Beranda B1/B2. Bukan tes regresi: dilewati kecuali `SCREENS=1`. Jalankan:
 * `SCREENS=1 playwright test -c playwright.ledger.config.ts screens-s7` (lingkungan sama dengan
 * e2e:ledger, data kosong dari global-setup). Satu urutan serial yang menyiapkan data lalu memotret.
 */
test.skip(process.env.SCREENS !== '1', 'screenshot hanya dengan SCREENS=1');
test.describe.configure({ mode: 'serial' });

const OUT_DIR = fileURLToPath(new URL('../../../../docs/design/s7/', import.meta.url));
const main = (page: Page) => page.getByRole('main');

const PRIBADI = 'BCA Pribadi';
const BESAR = 'Tabungan Dana Darurat Keluarga Besar'.slice(0, 40);
const BERSAMA = 'Kas Rumah';
const BERSAMA_PANJANG = 'Kas Rumah Tangga Bersama Novanda Farida'.slice(0, 40);
const LAMA = 'Dompet Lama';
const EMAIL_PANJANG = 'farida.nurmalasari.wulandari@keluarga-besar-nusantara.example.test';
const TALANGAN_1 = 'Makan siang klien Surabaya';
const TALANGAN_2 = 'Tiket kereta dinas ke Bandung';
const PINDAH_A = 'Belanja bulanan pasar';
const PINDAH_B = 'Galon dan gas';

const paths = {
  pribadiWallet: '',
  besarWallet: '',
  pribadiLeg: '',
  bersamaLeg: '',
  talangan1: '',
  talangan2: '',
  pindahA: '',
  pindahB: '',
  lama: '',
};

interface Shot {
  w: number;
  h: number;
  dpr: number;
  theme: 'dark' | 'light';
}
const V = (w: number, themes: ('dark' | 'light')[] = ['dark', 'light'], dpr = 1): Shot[] =>
  themes.map((theme) => ({ w, h: w === 1280 ? 800 : w === 320 ? 640 : 844, dpr, theme }));

/** Konteks baru berkas sesi pemilik, ukuran/tema/kerapatan piksel sesuai `shot`, lalu `fn`. */
async function withPage(
  browser: Browser,
  ownerState: string,
  shot: Shot,
  fn: (p: Page) => Promise<void>,
) {
  const context = await browser.newContext({
    storageState: ownerState,
    viewport: { width: shot.w, height: shot.h },
    deviceScaleFactor: shot.dpr,
    reducedMotion: 'reduce',
    baseURL: 'http://localhost:3301',
  });
  const page = await context.newPage();
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

const themed = (path: string, theme: string) =>
  `${path}${path.includes('?') ? '&' : '?'}theme=${theme}`;

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

interface Opts {
  full?: boolean;
  ready?: (p: Page) => Locator;
  prepare?: (p: Page) => Promise<void>;
}

/** Satu bidikan per varian. `prepare` mengatur keadaan sesudah halaman termuat. */
async function shoot(
  browser: Browser,
  ownerState: string,
  name: string,
  path: string,
  variants: Shot[],
  opts: Opts = {},
) {
  for (const v of variants) {
    await withPage(browser, ownerState, v, async (page) => {
      await page.goto(themed(path, v.theme));
      await expect(page.locator('html')).toHaveAttribute('data-theme', v.theme);
      if (opts.ready) await expect(opts.ready(page).first()).toBeVisible();
      if (opts.prepare) await opts.prepare(page);
      await settle(page);
      await page.screenshot({
        path: `${OUT_DIR}${name}-${String(v.w)}-${v.theme}.png`,
        fullPage: opts.full ?? false,
        animations: 'disabled',
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 0)
        console.log(`OVERFLOW ${name} ${String(v.w)} ${v.theme}: +${String(overflow)}px`);
    });
  }
}

async function openUntil(open: Locator, sheet: Locator, field: Locator) {
  await expect(async () => {
    if ((await sheet.count()) === 0) await open.click();
    await expect(field).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

async function accountId(name: string): Promise<string> {
  const [row] = await adminQuery<{ id: string }>(
    'select id::text from app.accounts where name = $1',
    [name],
  );
  if (!row) throw new Error(`dompet ${name} tidak ada`);
  return row.id;
}

async function openDetail(page: Page, ruang: 'pribadi' | 'bersama', description: string) {
  await page.goto(`/${ruang}/transaksi`);
  await main(page)
    .getByRole('link', { name: new RegExp(description) })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/${ruang}/transaksi/[0-9a-f-]{36}$`));
  return new URL(page.url()).pathname;
}

async function catatPribadi(
  page: Page,
  amount: number,
  description: string,
  wallet: string,
  talangan = false,
) {
  await page.goto('/pribadi/beranda');
  const sheet = await openCatat(page);
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill(String(amount));
  await sheet.getByLabel(/Keterangan/).fill(description);
  await sheet.getByLabel('Dari dompet').selectOption({ label: wallet });
  await chipsOf(sheet).first().click();
  if (talangan) await sheet.getByRole('switch', { name: 'Talangan kantor' }).click();
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(toasts(page).getByText(new RegExp(`Rp\\s${digits(amount)} dari`))).toBeVisible();
  await expect(sheet).toHaveCount(0);
}

test('B2 Bersama kosong, lalu dompet dan data', async ({ page, browser, ownerState }) => {
  test.setTimeout(600_000);
  // Beranda Bersama sebelum ada dompet: B2 (solo, tanpa undangan).
  await shoot(browser, ownerState, 'b2-bersama-kosong', '/bersama/beranda', [
    ...V(320, ['dark']),
    ...V(390, ['dark', 'light'], 2),
    ...V(1280),
  ]);

  await addWallet(page, 'pribadi', PRIBADI, 3_000_000);
  await addWallet(page, 'pribadi', BESAR, 12_345_678_900);
  await addWallet(page, 'bersama', BERSAMA, 1_000_000);
  await addWallet(page, 'bersama', BERSAMA_PANJANG, 500_000);
  paths.pribadiWallet = `/pribadi/dompet/${await accountId(PRIBADI)}`;
  paths.besarWallet = `/pribadi/dompet/${await accountId(BESAR)}`;

  // B1: Bersama satu anggota, pemilik, belum mengundang.
  await shoot(browser, ownerState, 'b1-ajakan', '/bersama/beranda', [
    ...V(320, ['dark']),
    ...V(390, ['dark', 'light'], 2),
    ...V(1280),
  ]);

  // Undangan dengan email panjang, lalu B1 undangan menunggu.
  await page.goto('/undang');
  await page.getByLabel('Email pasangan').fill(EMAIL_PANJANG);
  await page.getByRole('button', { name: 'Kirim undangan' }).click();
  await expect(page.getByText(/Undangan terkirim ke/)).toBeVisible();
  await shoot(browser, ownerState, 'b1-undangan-menunggu', '/bersama/beranda', [
    ...V(320, ['dark', 'light']),
    ...V(390, ['dark', 'light'], 2),
    ...V(1280),
  ]);
});

test('transfer antar ruang: Detail kedua kaki dan dialog Batalkan', async ({
  page,
  browser,
  ownerState,
}) => {
  test.setTimeout(300_000);
  await page.goto('/pribadi/beranda');
  await openCatat(page);
  const expense = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
  await expense.getByRole('button', { name: 'Pengeluaran · Pribadi' }).click();
  await page.getByRole('menuitemradio', { name: 'Transfer' }).click();
  let sheet = page.getByRole('dialog', { name: 'Transfer · Pribadi' });
  await sheet.getByLabel('Dari dompet').selectOption({ label: PRIBADI });
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill('250000');
  await sheet.getByRole('button', { name: /pilih dompet di ruang lain/ }).click();
  await page
    .getByRole('radiogroup', { name: 'Dompet di Bersama' })
    .getByRole('radio', { name: new RegExp(BERSAMA_PANJANG) })
    .click();
  sheet = page.getByRole('dialog', { name: 'Transfer · Pribadi → Bersama' });
  await sheet.getByLabel(/Keterangan \(hanya di Pribadi\)/).fill('Setoran kos adik');
  await sheet.getByLabel(/Catatan untuk Bersama/).fill('Setoran bulanan rumah');
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page).getByText(/Tersimpan di Pribadi · Rp\s250\.000 ke Bersama/),
  ).toBeVisible();

  const idOf = async (k: 'personal' | 'shared') => {
    const [r] = await adminQuery<{ id: string }>(
      `select id::text from app.entries where kind='space_transfer' and space_kind=$1::app.space_kind
        order by created_at desc limit 1`,
      [k],
    );
    return r?.id ?? '';
  };
  paths.pribadiLeg = `/pribadi/transaksi/${await idOf('personal')}`;
  paths.bersamaLeg = `/bersama/transaksi/${await idOf('shared')}`;
  const all = [...V(390, ['dark', 'light'], 2), ...V(1280)];
  const h1 = { ready: (pg: Page) => main(pg).getByRole('heading', { level: 1 }) };
  await shoot(browser, ownerState, 'd1-kaki-pribadi', paths.pribadiLeg, all, h1);
  await shoot(browser, ownerState, 'd1-kaki-bersama', paths.bersamaLeg, all, h1);
  await shoot(browser, ownerState, 'd1-kaki-pribadi', paths.pribadiLeg, V(320, ['dark']), h1);
  await shoot(browser, ownerState, 'd1-kaki-bersama', paths.bersamaLeg, V(320, ['dark']), h1);
  const dialogOpen = async (pg: Page) => {
    await main(pg).getByRole('button', { name: 'Batalkan transaksi' }).click();
    await expect(pg.getByRole('alertdialog')).toBeVisible();
  };
  await shoot(
    browser,
    ownerState,
    'd1-dialog-batalkan',
    paths.pribadiLeg,
    [...V(390, ['dark', 'light'], 2), ...V(1280, ['dark'])],
    { prepare: dialogOpen },
  );
  await shoot(browser, ownerState, 'd1-daftar-bersama', '/bersama/transaksi', V(390), {
    full: true,
  });
});

test('talangan dan Menunggu reimburse', async ({ page, browser, ownerState }) => {
  test.setTimeout(300_000);
  await catatPribadi(page, 500_000, TALANGAN_1, PRIBADI, true);
  await catatPribadi(page, 320_000, TALANGAN_2, BESAR, true);
  paths.talangan1 = await openDetail(page, 'pribadi', TALANGAN_1);
  paths.talangan2 = await openDetail(page, 'pribadi', TALANGAN_2);

  const baru = [...V(390, ['dark', 'light'], 2), ...V(1280)];
  await shoot(browser, ownerState, 'd3-talangan-baru', paths.talangan2, baru, {
    ready: (pg) => main(pg).getByText(/Menunggu reimburse · sisa/),
  });
  const sheetOf = (pg: Page) =>
    pg.getByRole('dialog').filter({ has: pg.getByRole('textbox', { name: 'Jumlah diganti' }) });
  await shoot(browser, ownerState, 'd3-sheet-reimburse', paths.talangan2, baru, {
    prepare: (pg) =>
      openUntil(
        main(pg).getByRole('button', { name: 'Catat reimburse' }),
        sheetOf(pg),
        sheetOf(pg).getByRole('textbox', { name: 'Jumlah diganti' }),
      ),
  });
  await shoot(
    browser,
    ownerState,
    'd3-dialog-tidak-diganti',
    paths.talangan2,
    V(390, ['dark', 'light'], 2),
    {
      prepare: async (pg) => {
        await main(pg).getByRole('button', { name: 'Tidak diganti' }).click();
        await expect(pg.getByRole('alertdialog')).toBeVisible();
      },
    },
  );

  // Reimburse sebagian untuk talangan 1 lewat UI.
  await page.goto(paths.talangan1);
  const sheet = sheetOf(page);
  await openUntil(
    main(page).getByRole('button', { name: 'Catat reimburse' }),
    sheet,
    sheet.getByRole('textbox', { name: 'Jumlah diganti' }),
  );
  await sheet.getByRole('textbox', { name: 'Jumlah diganti' }).fill('300000');
  await sheet.getByRole('button', { name: 'Simpan reimburse' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(main(page).getByText(/sisa Rp\s200\.000 dari Rp\s500\.000/)).toBeVisible();

  await shoot(browser, ownerState, 'd3-talangan-sebagian', paths.talangan1, [
    ...baru,
    ...V(320, ['dark']),
  ]);
  await shoot(
    browser,
    ownerState,
    'w4-dompet-menunggu-reimburse',
    '/pribadi/dompet',
    [...baru, ...V(320, ['dark'])],
    {
      full: true,
      ready: (pg) => main(pg).getByRole('list', { name: 'Talangan menunggu reimburse' }),
    },
  );
});

test('Pindahkan: sheet, konfirmasi, banner', async ({ page, browser, ownerState }) => {
  test.setTimeout(300_000);
  await catatPribadi(page, 187_500, PINDAH_A, BESAR);
  await catatPribadi(page, 45_000, PINDAH_B, PRIBADI);
  paths.pindahA = await openDetail(page, 'pribadi', PINDAH_A);
  paths.pindahB = await openDetail(page, 'pribadi', PINDAH_B);

  await shoot(browser, ownerState, 'd2-detail-biasa', paths.pindahA, V(390), {
    ready: (pg) => main(pg).getByRole('button', { name: 'Pindahkan ke Bersama' }),
    full: true,
  });
  const sheetOf = (pg: Page) => pg.getByRole('dialog', { name: 'Pindahkan ke Bersama' });
  const openSheet = async (pg: Page) => {
    await main(pg).getByRole('button', { name: 'Pindahkan ke Bersama' }).click();
    await expect(sheetOf(pg).getByLabel('Dompet di Bersama')).toBeVisible();
  };
  const fill = async (pg: Page) => {
    await openSheet(pg);
    await sheetOf(pg).getByLabel('Dompet di Bersama').selectOption({ label: BERSAMA_PANJANG });
    await chipsOf(sheetOf(pg)).first().click();
  };
  const all = [...V(390, ['dark', 'light'], 2), ...V(1280)];
  await shoot(browser, ownerState, 'd2-sheet-kosong', paths.pindahA, V(390, ['dark'], 2), {
    prepare: openSheet,
  });
  await shoot(
    browser,
    ownerState,
    'd2-sheet-terisi',
    paths.pindahA,
    [...all, ...V(320, ['dark'])],
    {
      prepare: fill,
    },
  );
  const confirm = async (pg: Page) => {
    await fill(pg);
    await sheetOf(pg).getByRole('checkbox', { name: 'Bawa keterangan' }).check();
    await sheetOf(pg).getByRole('button', { name: 'Lanjut' }).click();
    await expect(pg.getByRole('alertdialog', { name: 'Pindahkan ke Bersama?' })).toBeVisible();
  };
  await shoot(browser, ownerState, 'd2-konfirmasi', paths.pindahA, all, { prepare: confirm });

  // Pindahkan B lewat UI, lalu banner di URL lama.
  await page.goto(paths.pindahB);
  await fill(page);
  await sheetOf(page).getByRole('button', { name: 'Lanjut' }).click();
  await page
    .getByRole('alertdialog', { name: 'Pindahkan ke Bersama?' })
    .getByRole('button', { name: 'Pindahkan', exact: true })
    .click();
  await expect(page).toHaveURL(/\/bersama\/transaksi$/);
  await shoot(
    browser,
    ownerState,
    'd2-banner-dipindah',
    paths.pindahB,
    [...all, ...V(320, ['dark'])],
    { ready: (pg) => main(pg).getByText('Transaksi ini sudah dipindahkan ke Bersama.') },
  );
});

test('Cocokkan saldo dan Arsipkan', async ({ page, browser, ownerState }) => {
  test.setTimeout(300_000);
  const sheetOf = (pg: Page, name: string) =>
    pg.getByRole('dialog', { name: `Cocokkan saldo · ${name}` });
  const openCocok = async (pg: Page, name: string) => {
    const s = sheetOf(pg, name);
    await openUntil(
      main(pg).getByRole('button', { name: 'Cocokkan saldo' }),
      s,
      s.getByRole('textbox', { name: 'Saldo sebenarnya' }),
    );
    return s;
  };
  const currentOf = async (s: Locator) => {
    const m = /Rp\s([\d.]+)/.exec(await s.innerText());
    return Number((m?.[1] ?? '0').replaceAll('.', ''));
  };

  await shoot(browser, ownerState, 'w1-cocokkan-kosong', paths.pribadiWallet, V(390, ['dark'], 2), {
    prepare: async (pg) => {
      await openCocok(pg, PRIBADI);
    },
  });
  await shoot(
    browser,
    ownerState,
    'w1-cocokkan-naik',
    paths.pribadiWallet,
    [...V(390, ['dark', 'light'], 2), ...V(1280), ...V(320, ['dark'])],
    {
      prepare: async (pg) => {
        const s = await openCocok(pg, PRIBADI);
        const cur = await currentOf(s);
        await s.getByRole('textbox', { name: 'Saldo sebenarnya' }).fill(String(cur + 12_345));
        await expect(s.getByText(/Selisih\s\+Rp/)).toBeVisible();
      },
    },
  );
  await shoot(browser, ownerState, 'w1-cocokkan-turun', paths.pribadiWallet, V(390, ['dark'], 2), {
    prepare: async (pg) => {
      const s = await openCocok(pg, PRIBADI);
      await s.getByRole('textbox', { name: 'Saldo sebenarnya' }).fill('100');
      await expect(s.getByText(/Selisih\s−Rp/)).toBeVisible();
    },
  });
  await shoot(browser, ownerState, 'w1-cocokkan-sama', paths.pribadiWallet, V(390, ['dark'], 2), {
    prepare: async (pg) => {
      const s = await openCocok(pg, PRIBADI);
      await s.getByRole('textbox', { name: 'Saldo sebenarnya' }).fill(String(await currentOf(s)));
      await expect(s.getByText('Saldo sudah sama. Tidak ada yang perlu dicocokkan.')).toBeVisible();
    },
  });
  await shoot(
    browser,
    ownerState,
    'w1-riwayat-dompet-besar',
    paths.besarWallet,
    [...V(320, ['dark']), ...V(390, ['dark', 'light'], 2), ...V(1280)],
    { full: true, ready: (pg) => main(pg).getByRole('button', { name: 'Cocokkan saldo' }) },
  );

  // Arsipkan: saldo bukan 0 (kartu keterangan), saldo 0 (tombol + dialog), lalu kartu Diarsipkan.
  await addWallet(page, 'pribadi', LAMA, 10_000);
  await page.goto('/pribadi/dompet');
  await main(page)
    .getByRole('link', { name: new RegExp(LAMA) })
    .click();
  await expect(page).toHaveURL(/\/pribadi\/dompet\/[0-9a-f-]{36}$/);
  paths.lama = new URL(page.url()).pathname;
  await shoot(
    browser,
    ownerState,
    'w3-arsip-saldo-berisi',
    paths.lama,
    [...V(390, ['dark', 'light'], 2), ...V(1280)],
    { full: true, ready: (pg) => main(pg).getByText(/masih berisi saldo/) },
  );

  const s = await openCocok(page, LAMA);
  await s.getByRole('textbox', { name: 'Saldo sebenarnya' }).fill('0');
  await s.getByRole('button', { name: 'Cocokkan saldo' }).click();
  await expect(toasts(page).getByText(/dicocokkan di Pribadi/)).toBeVisible();
  const arsipDialog = async (pg: Page) => {
    await main(pg).getByRole('button', { name: 'Arsipkan dompet' }).click();
    await expect(pg.getByRole('alertdialog')).toBeVisible();
  };
  await shoot(browser, ownerState, 'w3-arsip-saldo-nol', paths.lama, V(390), {
    full: true,
    ready: (pg) => main(pg).getByRole('button', { name: 'Arsipkan dompet' }),
  });
  await shoot(
    browser,
    ownerState,
    'w3-arsip-dialog',
    paths.lama,
    [...V(390, ['dark', 'light'], 2), ...V(1280, ['dark'])],
    { prepare: arsipDialog },
  );
  await arsipDialog(page);
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Arsipkan', exact: true })
    .click();
  await expect(page).toHaveURL(/\/pribadi\/dompet$/);
  await shoot(
    browser,
    ownerState,
    'w3-dompet-diarsipkan',
    '/pribadi/dompet',
    [...V(390, ['dark', 'light'], 2), ...V(1280)],
    { full: true, ready: (pg) => main(pg).getByText('Diarsipkan').first() },
  );
});

test('Catat 360: geseran chip saran saat dipilih (T17)', async ({ browser, ownerState }) => {
  await withPage(browser, ownerState, { w: 360, h: 356, dpr: 1, theme: 'dark' }, async (page) => {
    await page.goto('/pribadi/beranda');
    const sheet = await openCatat(page);
    await page.keyboard.type('150000');
    const chips = chipsOf(sheet);
    const n = await chips.count();
    const snap = () =>
      chips.evaluateAll((els) =>
        els.map(
          (e) =>
            `${e.textContent.trim()}:${String(Math.round(e.getBoundingClientRect().left))}-${String(Math.round(e.getBoundingClientRect().right))}`,
        ),
      );
    const rows: string[] = [`awal ${(await snap()).join(' ')}`];
    for (let i = 0; i < Math.min(n, 5); i++) {
      await chips.nth(i).click();
      rows.push(`pilih ${String(i)} -> ${(await snap()).join(' ')}`);
    }
    console.log(`CHIPSHIFT n=${String(n)}\n${rows.join('\n')}`);
    await settle(page);
    await page.screenshot({ path: `${OUT_DIR}c-chip-saran-keyboard-360-dark.png` });
  });
});

test('target sentuh < 44 px dan tombol turun baris di 320/360/390', async ({
  browser,
  ownerState,
}) => {
  test.setTimeout(240_000);
  const urls = [
    '/pribadi/beranda',
    '/bersama/beranda',
    '/pribadi/dompet',
    paths.pribadiLeg,
    paths.bersamaLeg,
    paths.talangan1,
    paths.pindahB,
    paths.pribadiWallet,
    paths.lama,
  ].filter(Boolean);
  const report: string[] = [];
  for (const w of [320, 360, 390]) {
    await withPage(browser, ownerState, { w, h: 800, dpr: 1, theme: 'dark' }, async (page) => {
      for (const url of urls) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        const small = await page.evaluate(() => {
          const out: string[] = [];
          const sel = 'a[href], button, select, input, textarea, [role="switch"], [role="radio"]';
          for (const el of document.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            if (r.width === 0 || r.height === 0 || st.visibility === 'hidden') continue;
            if (el.closest('.sr-only')) continue;
            if (r.height < 43.5 || r.width < 43.5) {
              const t = el.textContent.trim().slice(0, 30);
              const name = t === '' ? (el.getAttribute('aria-label') ?? el.tagName) : t;
              out.push(`${name} ${String(Math.round(r.width))}x${String(Math.round(r.height))}`);
            }
          }
          return out;
        });
        if (small.length > 0)
          report.push(`${String(w)} ${url.replace(/[0-9a-f-]{36}/, ':id')}: ${small.join(' | ')}`);
      }
    });
  }
  console.log(`TARGETS\n${report.join('\n') || 'tidak ada'}`);
});
