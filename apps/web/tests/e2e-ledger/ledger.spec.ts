import type { Locator, Page, Route } from '@playwright/test';
import { expectNoSeriousViolations, WCAG_TAGS } from '../e2e/axe';
import { routeScripts } from '../e2e/route-scripts';
import { noHorizontalScroll } from '../e2e-auth/helpers';
import { adminQuery, expect, test } from './fixtures';
import {
  addWallet,
  bersamaResponses,
  BUDGET_KB,
  catatCepat,
  chipsOf,
  catatSheet,
  digits,
  expectRouteBudget,
  openAndFill,
  openCatat,
  spaceId,
  toasts,
  trigger,
  walletBalance,
} from './helpers';

/**
 * Kriteria keluar S6 ujung ke ujung di mode nyata (Task 19): Catat ≤ 3 ketukan dari Beranda,
 * Transaksi, Dompet di kedua ruang; Batalkan → Sampah → Pulihkan; Urungkan; idempotensi (klik ganda,
 * koneksi putus sesudah server menyimpan); saldo kurang; konflik versi; hari tanpa pengeluaran;
 * event produk tanpa nominal; rute Bersama tanpa kanari Pribadi (HTML + RSC); tanpa data demo;
 * keyboard saja; axe; budget JS. Satu urutan serial: tiap tes memakai ledger tes sebelumnya.
 */

test.describe.configure({ mode: 'serial' });

const PRIBADI_WALLET = 'KANARI-DOMPET-N';
const PRIBADI_KANARI = 'KANARI-N-PRIBADI';
const BERSAMA_WALLET = 'Kas Bersama E2E';

/** Deskripsi khas entri seed demo (packages/demo-data); tidak pernah tampil di mode nyata. */
const SEED_MARKERS = ['Belanja mingguan', 'Gaji bulanan', 'Kopi susu'];

const entriesWith = async (description: string) =>
  (
    await adminQuery<{ n: string }>(
      'select count(*)::text as n from app.entries where description = $1',
      [description],
    )
  )[0]?.n;

/** POST Server Action simpan Catat (payload `saveCatat` memuat `allowNegative`). */
const isSaveCatat = (route: Route) => {
  const r = route.request();
  return (
    r.method() === 'POST' &&
    r.headers()['next-action'] !== undefined &&
    (r.postData() ?? '').includes('"allowNegative"')
  );
};

const countEntries = async () =>
  (await adminQuery<{ n: string }>('select count(*)::text as n from app.entries'))[0]?.n;

let detailPath = '';

test('Tidak ada pengeluaran hari ini', async ({ page }) => {
  // Dompet Pribadi pertama (saldo awal tidak dihitung sebagai catatan hari ini).
  await addWallet(page, 'pribadi', PRIBADI_WALLET, 5_000_000);
  await page.goto('/pribadi/beranda');
  const mark = page.getByRole('button', { name: 'Tidak ada pengeluaran hari ini' });
  await mark.click();
  const status = page
    .getByRole('status')
    .filter({ hasText: 'Hari ini tercatat tanpa pengeluaran.' });
  await expect(status).toBeVisible();
  await expect(status).toBeFocused();
  await expect(mark).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Hari ini tercatat tanpa pengeluaran.')).toBeVisible();
  await expect(mark).toHaveCount(0);

  const sid = await spaceId('personal');
  const days = await adminQuery<{ on_date: string; today: string }>(
    `select on_date::text, app.today()::text as today from app.no_spend_days where space_id = $1`,
    [sid],
  );
  expect(days).toHaveLength(1);
  // Tanggal = hari WIB server (app.today()), bukan zona browser.
  expect(days[0]?.on_date).toBe(days[0]?.today);
  const events = await adminQuery<{ space_kind: string }>(
    `select space_kind::text from app.product_events where event = 'tanpa_pengeluaran'`,
  );
  expect(events).toEqual([{ space_kind: 'personal' }]);
});

test('Beranda Bersama kosong (B2) dan solo (B1) sebelum ada dompet Bersama', async ({ page }) => {
  // Bersama tanpa dompet operasional dan tanpa entri (persona N tanpa F): State kosong S7-B2.
  await page.goto('/bersama/beranda');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Bersama belum punya dompet.' })).toBeVisible();
  const add = main.getByRole('link', { name: 'Tambah dompet' });
  await expect(add).toHaveAttribute('href', /^\/bersama\/dompet\?tambah=1/);
  // B1 tetap berlaku: kartu ajakan untuk pemilik, pengantar checklist satu anggota, Aktivitas kosong.
  await expect(main.getByRole('link', { name: 'Undang Farida ke Bersama' })).toBeVisible();
  await expect(main.getByText('Ruang untuk keuangan bersama.')).toBeVisible();
  await expect(main.getByText(/^Belum ada aktivitas\./)).toBeVisible();
  for (const theme of ['dark', 'light']) {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/bersama/beranda?theme=${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(add).toBeVisible();
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      if (width === 320) await noHorizontalScroll(page);
    }
  }
});

test('Tambah dompet lalu Catat ≤ 3 ketukan dari Beranda, Transaksi, Dompet di Pribadi dan Bersama', async ({
  page,
}) => {
  await addWallet(page, 'bersama', BERSAMA_WALLET, 2_000_000);
  let amount = 11_000;
  for (const ruang of ['pribadi', 'bersama'] as const) {
    const wallet = ruang === 'pribadi' ? PRIBADI_WALLET : BERSAMA_WALLET;
    for (const screen of ['beranda', 'transaksi', 'dompet']) {
      await page.goto(`/${ruang}/${screen}`);
      amount += 1_000;
      const taps = await catatCepat(page, { amount, ruang, wallet });
      test
        .info()
        .annotations.push({ type: `ketukan ${ruang}/${screen}`, description: String(taps) });
      expect(taps).toBeLessThanOrEqual(3);
    }
  }
  // Semua tersimpan di ruang masing-masing.
  const per = await adminQuery<{ kind: string; n: string }>(
    `select space_kind::text as kind, count(*)::text as n from app.entries
      where kind = 'expense' and voided_at is null group by 1 order by 1`,
  );
  expect(per).toEqual([
    { kind: 'personal', n: '3' },
    { kind: 'shared', n: '3' },
  ]);
  // Pribadi sudah ditandai tanpa pengeluaran (tes sebelumnya) lalu ada pengeluaran hari ini:
  // tombol dan status tanda tidak tampil; baris no_spend_days tetap ada.
  await page.goto('/pribadi/beranda');
  await expect(page.getByTestId('balance-card')).toBeVisible();
  await expect(page.getByText('Hari ini tercatat tanpa pengeluaran.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tidak ada pengeluaran hari ini' })).toHaveCount(0);
  const marked = await adminQuery<{ n: string }>(
    `select count(*)::text as n from app.no_spend_days where space_id = $1`,
    [await spaceId('personal')],
  );
  expect(marked[0]?.n).toBe('1');
});

test('event tanpa nominal', async ({ page }) => {
  await page.goto('/pribadi/beranda');
  const before =
    (
      await adminQuery<{ id: string }>(
        'select coalesce(max(id), 0)::text as id from app.product_events',
      )
    )[0]?.id ?? '0';
  expect(await catatCepat(page, { amount: 18_000, ruang: 'pribadi', wallet: PRIBADI_WALLET })).toBe(
    3,
  );
  // Kirim-dan-lupakan: tunggu event tiba.
  await expect
    .poll(
      async () =>
        (
          await adminQuery<{ n: string }>(
            `select count(*)::text as n from app.product_events where id > $1 and event = 'catat_disimpan'`,
            [before],
          )
        )[0]?.n,
    )
    .toBe('1');
  const rows = await adminQuery<{
    event: string;
    flow_id: string | null;
    taps: number | null;
    duration_ms: number | null;
    space_kind: string;
  }>(
    `select event, flow_id::text, taps, duration_ms, space_kind::text
       from app.product_events where id > $1 order by id`,
    [before],
  );
  const dibuka = rows.find((r) => r.event === 'catat_dibuka');
  const disimpan = rows.find((r) => r.event === 'catat_disimpan');
  expect(dibuka?.flow_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(disimpan?.flow_id).toBe(dibuka?.flow_id);
  expect(disimpan?.taps).toBe(3);
  expect(disimpan?.duration_ms).toBeGreaterThanOrEqual(0);
  expect(disimpan?.space_kind).toBe('personal');
  expect(rows.filter((r) => r.event === 'catat_batal')).toEqual([]);
  // Tabel event tidak punya kolom untuk nominal, deskripsi, id entri, atau id kategori.
  const cols = await adminQuery<{ c: string }>(
    `select column_name as c from information_schema.columns
      where table_schema = 'app' and table_name = 'product_events' order by ordinal_position`,
  );
  expect(cols.map((c) => c.c)).toEqual([
    'id',
    'user_id',
    'space_kind',
    'event',
    'flow_id',
    'taps',
    'duration_ms',
    'at',
  ]);
});

test('Catat → Transaksi → Batalkan → Sampah → Pulihkan', async ({ page }) => {
  const DESC = 'BATAL-PULIHKAN-E2E';
  const main = page.getByRole('main');
  const saldo0 = await walletBalance(page, 'pribadi', PRIBADI_WALLET);
  await page.goto('/pribadi/beranda');
  await catatCepat(page, {
    amount: 12_345,
    ruang: 'pribadi',
    wallet: PRIBADI_WALLET,
    description: DESC,
  });
  expect(await walletBalance(page, 'pribadi', PRIBADI_WALLET)).toBe(saldo0 - 12_345);

  await page.goto('/pribadi/transaksi');
  await main.getByRole('link', { name: new RegExp(DESC) }).click();
  await expect(page).toHaveURL(/\/pribadi\/transaksi\/[0-9a-f-]{36}$/);
  detailPath = new URL(page.url()).pathname;
  await main.getByRole('button', { name: 'Batalkan transaksi' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Batalkan transaksi' }).click();
  await expect(page).toHaveURL(/\/pribadi\/transaksi$/);
  await expect(main.getByText(DESC)).toHaveCount(0);
  expect(await walletBalance(page, 'pribadi', PRIBADI_WALLET)).toBe(saldo0);

  await page.goto('/pribadi/sampah');
  const row = main.getByRole('listitem').filter({ hasText: DESC });
  await expect(row).toContainText('12.345');
  await row.getByRole('button', { name: new RegExp(`^Pulihkan ${DESC}`) }).click();
  await expect(toasts(page).getByText('Dipulihkan di Pribadi · Rp 12.345')).toBeVisible();
  await page.goto('/pribadi/transaksi');
  await expect(main.getByRole('link', { name: new RegExp(DESC) })).toHaveCount(1);
  expect(await walletBalance(page, 'pribadi', PRIBADI_WALLET)).toBe(saldo0 - 12_345);
});

test('Urungkan 6 detik mengembalikan saldo', async ({ page }) => {
  const DESC = 'URUNGKAN-E2E';
  const saldo0 = await walletBalance(page, 'bersama', BERSAMA_WALLET);
  await catatCepat(page, {
    amount: 7_000,
    ruang: 'bersama',
    wallet: BERSAMA_WALLET,
    description: DESC,
  });
  await toasts(page).getByRole('button', { name: 'Urungkan' }).click();
  await expect.poll(() => entriesWith(DESC)).toBe('1');
  await expect
    .poll(
      async () =>
        (
          await adminQuery<{ voided: boolean }>(
            'select voided_at is not null as voided from app.entries where description = $1',
            [DESC],
          )
        )[0]?.voided,
    )
    .toBe(true);
  expect(await walletBalance(page, 'bersama', BERSAMA_WALLET)).toBe(saldo0);
  await page.goto('/bersama/transaksi');
  await expect(page.getByRole('main').getByText(DESC)).toHaveCount(0);
});

test('klik ganda Simpan = satu baris', { tag: ['@C6'] }, async ({ page }) => {
  const DESC = 'KLIK-GANDA-E2E';
  await page.goto('/pribadi/transaksi');
  const sheet = await openAndFill(page, { amount: 13_579, description: DESC });
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).dblclick();
  await expect(toasts(page).getByText(/Rp\s13\.579/)).toHaveCount(1);
  await expect(sheet).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('main').getByRole('link', { name: new RegExp(DESC) })).toHaveCount(1);
  expect(await entriesWith(DESC)).toBe('1');
});

test('koneksi putus lalu Coba lagi', { tag: ['@C7'] }, async ({ page }) => {
  const DESC = 'PUTUS-E2E';
  await page.goto('/pribadi/beranda');
  // Permintaan simpan pertama sampai di server (tersimpan), lalu koneksinya putus sebelum jawaban.
  let cut = 0;
  await page.route('**/*', async (route) => {
    if (cut === 0 && isSaveCatat(route)) {
      cut += 1;
      await route.fetch();
      await route.abort('connectionreset');
      return;
    }
    await route.fallback();
  });
  const sheet = await openAndFill(page, { amount: 24_680, description: DESC });
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(sheet.getByRole('alert')).toHaveText(
    'Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan mencatat dua kali.',
  );
  const retry = sheet.getByRole('button', { name: 'Coba lagi' });
  await expect(retry).toBeFocused();
  expect(cut).toBe(1);
  expect(await entriesWith(DESC)).toBe('1');
  await retry.click();
  await expect(
    toasts(page).getByText(`Tersimpan di Pribadi · Rp 24.680 dari ${PRIBADI_WALLET}`),
  ).toHaveCount(1);
  await expect(sheet).toHaveCount(0);
  await page.unroute('**/*');
  expect(await entriesWith(DESC)).toBe('1');
});

test('saldo kurang: peringatan inline lalu Tetap simpan', async ({ page }) => {
  const saldo0 = await walletBalance(page, 'bersama', BERSAMA_WALLET);
  const amount = saldo0 + 250_000;
  await page.goto('/bersama/beranda');
  const sheet = await openAndFill(page, { amount });
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    sheet.getByRole('status').filter({
      hasText: `Saldo ${BERSAMA_WALLET} tinggal Rp ${digits(saldo0)}. Kalau disimpan, saldonya jadi −Rp 250.000.`,
    }),
  ).toBeVisible();
  // Inline, bukan dialog.
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  const anyway = sheet.getByRole('button', { name: 'Tetap simpan' });
  await expect(anyway).toBeFocused();
  await anyway.click();
  await expect(
    toasts(page).getByText(`Tersimpan di Bersama · Rp ${digits(amount)} dari ${BERSAMA_WALLET}`),
  ).toBeVisible();
  expect(await walletBalance(page, 'bersama', BERSAMA_WALLET)).toBe(-250_000);
});

test('konflik versi', { tag: ['@C8'] }, async ({ page, browser, ownerState }) => {
  expect(detailPath).not.toBe('');
  const entryId = detailPath.split('/').at(-1);
  const versionOf = async () =>
    (
      await adminQuery<{ v: number }>('select version as v from app.entries where id = $1', [
        entryId,
      ])
    )[0]?.v;
  const v0 = (await versionOf()) ?? 0;
  const first = page;
  const other = await browser.newContext({ storageState: ownerState });
  try {
    const second = await other.newPage();
    for (const p of [first, second]) {
      await p.goto(detailPath);
      const nominal = p
        .getByRole('dialog', { name: 'Ubah transaksi' })
        .getByRole('textbox', { name: 'Nominal' });
      // Konteks baru (cache dingin): klik sebelum hidrasi selesai tidak membuka sheet; ulangi.
      await expect(async () => {
        if ((await nominal.count()) === 0) {
          await p.getByRole('main').getByRole('button', { name: 'Ubah' }).click();
        }
        await expect(nominal).toHaveValue('12.345', { timeout: 1_000 });
      }).toPass();
    }
    const sheet1 = first.getByRole('dialog', { name: 'Ubah transaksi' });
    await sheet1.getByRole('textbox', { name: 'Nominal' }).fill('20000');
    await sheet1.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect(sheet1).toHaveCount(0);

    const sheet2 = second.getByRole('dialog', { name: 'Ubah transaksi' });
    await sheet2.getByRole('textbox', { name: 'Nominal' }).fill('21000');
    await sheet2.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect(sheet2.getByRole('alert')).toHaveText(
      /^Kamu mengubah transaksi ini baru saja \(Rp\s12\.345 → Rp\s20\.000\)\. Muat versi terbaru untuk melanjutkan\.$/,
    );
    await expect(sheet2.getByRole('group', { name: 'Nilai terbaru' })).toContainText('20.000');
    await expect(sheet2.getByRole('button', { name: 'Muat ulang' })).toBeFocused();
    // Tidak menimpa diam-diam: server tetap memegang nilai konteks pertama.
    expect(await versionOf()).toBe(v0 + 1);
    await first.reload();
    await expect(first.getByRole('main').getByText(/^−Rp\s20\.000$/)).toBeVisible();
  } finally {
    await other.close();
  }
});

/** Respons Bersama terbaca semua, ada isinya, dan tanpa kanari Pribadi (nama dompet dan keterangan). */
function expectNoPribadi({ bodies, unread }: { bodies: string[]; unread: string[] }) {
  expect(unread).toEqual([]);
  expect(bodies.length).toBeGreaterThan(0);
  expect(bodies.some((b) => b.includes('Bersama'))).toBe(true);
  for (const body of bodies) {
    expect(body).not.toContain(PRIBADI_KANARI);
    expect(body).not.toContain(PRIBADI_WALLET);
  }
}

test('payload rute Bersama tanpa kanari Pribadi', async ({ page }) => {
  await page.goto('/pribadi/beranda');
  await catatCepat(page, {
    amount: 31_000,
    ruang: 'pribadi',
    wallet: PRIBADI_WALLET,
    description: PRIBADI_KANARI,
  });
  // Kanari benar-benar ada di Pribadi (tes tidak lulus karena data kosong).
  const pribadi = await (await page.request.get('/pribadi/transaksi')).text();
  expect(pribadi).toContain(PRIBADI_KANARI);
  expect(pribadi).toContain(PRIBADI_WALLET);

  const routes = ['beranda', 'transaksi', 'dompet', 'sampah', 'kategori'];
  const expectClean = async () => {
    for (const r of routes) {
      const html = await (await page.request.get(`/bersama/${r}`)).text();
      const rsc = await (await page.request.get(`/bersama/${r}`, { headers: { RSC: '1' } })).text();
      expect(html).toContain('Bersama');
      for (const body of [html, rsc]) {
        expect(body).not.toContain(PRIBADI_KANARI);
        expect(body).not.toContain(PRIBADI_WALLET);
      }
    }
  };
  await expectClean();

  // Navigasi browser: dokumen awal dan semua payload RSC rute Bersama (termasuk navigasi klien).
  for (const r of routes) {
    expectNoPribadi(await bersamaResponses(page, () => page.goto(`/bersama/${r}`)));
  }
  const nav = await bersamaResponses(page, async () => {
    await page
      .getByRole('navigation', { name: 'Navigasi utama' })
      .getByRole('link', { name: 'Transaksi' })
      .click();
    await expect(page).toHaveURL(/\/bersama\/transaksi$/);
  });
  expectNoPribadi(nav);

  // Sheet Catat di Bersama, pindah ke Pribadi: dompet Pribadi diambil lewat action saat itu.
  await page.goto('/bersama/beranda');
  const sheet = await openCatat(page);
  await expect(sheet.getByLabel('Dari dompet')).toContainText(BERSAMA_WALLET);
  await expect(sheet).not.toContainText(PRIBADI_WALLET);
  await sheet.getByRole('button', { name: /Pindah ke Pribadi/ }).click();
  await expect(sheet.getByLabel('Dari dompet')).toContainText(PRIBADI_WALLET);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // HTML awal rute Bersama tetap bersih sesudahnya.
  expectNoPribadi(await bersamaResponses(page, () => page.reload()));
  await expectClean();
});

test('tidak ada teks "Data demo" di mode nyata', async ({ page }) => {
  const paths = ['beranda', 'transaksi', 'dompet', 'sampah', 'kategori'].flatMap((r) => [
    `/pribadi/${r}`,
    `/bersama/${r}`,
  ]);
  for (const path of [...paths, detailPath]) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    const rsc = await (await page.request.get(path, { headers: { RSC: '1' } })).text();
    // HTML + payload RSC: tanpa label "Data demo" dan tanpa isi seed demo.
    for (const body of [(await res?.text()) ?? '', rsc]) {
      expect(body, path).not.toContain('Data demo');
      for (const marker of SEED_MARKERS) expect(body, path).not.toContain(marker);
    }
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Data demo')).toHaveCount(0);
  }
  // Sheet Catat (dimuat malas) juga dari ledger: dompet nyata, tanpa data demo.
  const sheet = await openCatat(page);
  await expect(sheet.getByLabel('Dari dompet')).toContainText(PRIBADI_WALLET);
  await expect(page.getByText('Data demo')).toHaveCount(0);
  for (const marker of SEED_MARKERS) await expect(page.getByText(marker)).toHaveCount(0);
  await page.keyboard.press('Escape');
});

/**
 * Penanda kode seed demo (packages/demo-data/src/seed.ts): deskripsi entri dan id kategori/anggota
 * yang hanya ada di seed, jadi muncul di chunk JS hanya bila `createSeed` ikut dibundel.
 */
const SEED_CODE_MARKERS = [...SEED_MARKERS, 'cp-makan', 'm-novanda'];

test('JS mode nyata tanpa seed demo (K3)', async ({ browser, ownerState }) => {
  const paths = ['beranda', 'transaksi', 'dompet', 'sampah', 'kategori'].flatMap((r) => [
    `/pribadi/${r}`,
    `/bersama/${r}`,
  ]);
  expect(detailPath).not.toBe('');
  // /bersama/aktivitas (S8): page.tsx mengimpor view demo klien secara statis; chunk-nya harus
  // bersih dari seed di mode nyata.
  for (const path of [...paths, '/bersama/aktivitas', detailPath]) {
    // Konteks baru per rute: semua JS yang dimuat rute ini (muat awal, prefetch, muat malas
    // sampai jaringan diam) tidak boleh memuat seed demo.
    const context = await browser.newContext({ storageState: ownerState });
    const page = await context.newPage();
    const scripts: Promise<{ url: string; body: string }>[] = [];
    page.on('response', (r) => {
      if (new URL(r.url()).pathname.endsWith('.js'))
        scripts.push(r.text().then((body) => ({ url: r.url(), body })));
    });
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    const own = routeScripts((await res?.text()) ?? '');
    await page.waitForLoadState('networkidle');
    const loaded = await Promise.all(scripts);
    await context.close();
    // Setiap skrip rute ikut diperiksa (bukan lolos karena tidak tertangkap).
    const seen = new Set(loaded.map((s) => new URL(s.url).pathname));
    expect(
      [...own].filter((p) => !seen.has(p)),
      path,
    ).toEqual([]);
    for (const { url, body } of loaded)
      for (const marker of SEED_CODE_MARKERS)
        expect(body.includes(marker), `${path}: ${new URL(url).pathname} memuat "${marker}"`).toBe(
          false,
        );
  }
});

test('keyboard saja', async ({ page }) => {
  await page.goto('/pribadi/transaksi');
  await expect(
    page.getByRole('main').getByRole('link', { name: new RegExp(PRIBADI_KANARI) }),
  ).toBeVisible();
  const sheet = catatSheet(page);
  // Pintasan `c` dipasang shell sesudah hidrasi; tekan sebelum itu tidak membuka apa pun. Ulangi
  // hanya bila belum ada dialog (pola `openCatat`).
  await expect(async () => {
    if ((await page.getByRole('dialog').count()) === 0) await page.keyboard.press('c');
    await expect(chipsOf(sheet).first()).toBeVisible({ timeout: 2_000 });
  }).toPass();
  const nominal = sheet.getByRole('textbox', { name: 'Nominal' });
  await expect(nominal).toBeFocused();
  await page.keyboard.type('4321');
  await page.keyboard.press('Tab');
  await expect(chipsOf(sheet).first()).toBeFocused();
  await page.keyboard.press('Space');
  await expect(chipsOf(sheet).first()).toHaveAttribute('aria-checked', 'true');
  // Enter di chip (tombol) memilih, bukan menyimpan: Tab ke Simpan lalu Enter (pola a11y.spec.ts).
  const simpan = sheet.getByRole('button', { name: 'Simpan', exact: true });
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    if (await simpan.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(simpan).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    toasts(page).getByText(`Tersimpan di Pribadi · Rp 4.321 dari ${PRIBADI_WALLET}`),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();

  // Esc menutup tanpa menyimpan; fokus kembali ke pemicu.
  await page.keyboard.press('c');
  await expect(sheet.getByRole('textbox', { name: 'Nominal' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
});

test('axe 0 serious/critical terang + gelap di 320/390/1280; tanpa gulir horizontal di 320', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const entries0 = await countEntries();
  const screens: { path: string; ready: (p: Page) => Locator }[] = [
    { path: '/pribadi/beranda', ready: (p) => p.getByTestId('balance-card') },
    { path: '/pribadi/transaksi', ready: (p) => p.getByRole('main').getByText(PRIBADI_KANARI) },
    { path: detailPath, ready: (p) => p.getByRole('main').getByRole('button', { name: 'Ubah' }) },
    {
      path: '/pribadi/dompet',
      ready: (p) => p.getByRole('main').getByText(PRIBADI_WALLET).first(),
    },
    {
      path: '/pribadi/sampah',
      ready: (p) => p.getByRole('main').getByRole('heading', { level: 1 }),
    },
    {
      path: '/pribadi/kategori',
      ready: (p) => p.getByRole('main').getByRole('heading', { level: 1 }),
    },
    {
      path: '/bersama/dompet',
      ready: (p) => p.getByRole('main').getByText(BERSAMA_WALLET).first(),
    },
  ];
  for (const theme of ['dark', 'light']) {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const s of screens) {
        await page.goto(`${s.path}?theme=${theme}`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(s.ready(page)).toBeVisible();
        await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
        if (width === 320) await noHorizontalScroll(page);
      }
      // Sheet Catat dalam keadaan galat (simpan gagal di jaringan; tidak ada yang tersimpan).
      await page.route('**/*', async (route) => {
        if (isSaveCatat(route)) await route.abort('connectionreset');
        else await route.fallback();
      });
      await page.goto(`/pribadi/beranda?theme=${theme}`);
      const sheet = await openAndFill(page, { amount: 9_999 });
      await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
      await expect(sheet.getByRole('alert')).toBeVisible();
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      if (width === 320) await noHorizontalScroll(page);
      await page.keyboard.press('Escape');
      await page.unroute('**/*');
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/pribadi/beranda?theme=dark');
  // Simpan yang gagal di jaringan tidak pernah sampai server.
  expect(await countEntries()).toBe(entries0);
});

for (const path of [
  '/pribadi/beranda',
  '/pribadi/transaksi',
  'detail',
  '/pribadi/sampah',
  '/pribadi/dompet',
]) {
  test(`JS muat dingin ${path} mode nyata ≤ ${String(BUDGET_KB)} kB`, async ({
    browser,
    ownerState,
  }) => {
    const url = path === 'detail' ? detailPath : path;
    expect(url).not.toBe('');
    await expectRouteBudget(browser, ownerState, url);
  });
}
