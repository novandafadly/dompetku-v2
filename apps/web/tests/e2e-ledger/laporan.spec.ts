import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../e2e/axe';
import { randomUUID } from 'node:crypto';
import { asUser, noHorizontalScroll, spaceOf } from '../e2e-auth/helpers';
import { adminQuery, expect, OWNER, test } from './fixtures';
import {
  addWallet,
  bersamaResponses,
  chipsOf,
  digits,
  expectRouteBudget,
  openCatat,
  spaceId,
  toasts,
} from './helpers';

/**
 * S9 Task 13 mode nyata: Laporan `/[ruang]/laporan`. Angka Ringkasan = SQL (`app.report_lines`
 * periode yang sama), Tidak termasuk, kategori terurut, tren, pemilih periode (gajian/kalender),
 * parameter rusak = periode berjalan, kosong, Beranda/Rencana = Laporan, Bersama tanpa data
 * Pribadi (B13), axe, dan budget JS. Spec ini MENGISI data dan tidak membersihkannya: project
 * `data` (`playwright.ledger.config.ts`, setelah `kosong`). Nama dompet unik.
 */
test.describe.configure({ mode: 'serial' });

const main = (page: Page) => page.getByRole('main');
const W_A = 'Dompet Laporan A';
const W_B = 'Dompet Laporan B';
const W_BERSAMA = 'Kas Patungan Laporan';
const KAT_MAKAN = 'Hiburan';
const KAT_TRANSPORT = 'Langganan';
const KAT_DAPUR = 'Belanja Dapur';

const txt = async (l: Locator) => (await l.innerText()).replaceAll(' ', ' ');
const rp = (n: number) => `Rp ${digits(n)}`;

interface Truth {
  pemasukan: number;
  pengeluaran: number;
  from: string;
  to: string;
}

/** Kebenaran SQL periode yang memuat hari ini (`gajian`) atau bulan kalender hari ini. */
async function truth(kind: 'personal' | 'shared', basis: 'gajian' | 'kalender'): Promise<Truth> {
  const [r] = await adminQuery<{ inc: string; exp: string; f: string; t: string }>(
    `with p as (
       select case when $2 = 'gajian' then starts_on else date_trunc('month', app.today())::date end as s,
              case when $2 = 'gajian' then ends_on
                   else (date_trunc('month', app.today()) + interval '1 month - 1 day')::date end as e
         from app.pay_period($1, app.today()))
     select coalesce((select sum(amount) from app.report_lines r, p where r.space_id = $1
                       and r.occurred_on between p.s and p.e and r.report_class = 'income'), 0)::text as inc,
            coalesce((select -sum(amount) from app.report_lines r, p where r.space_id = $1
                       and r.occurred_on between p.s and p.e
                       and r.report_class in ('expense', 'expense_fee')), 0)::text as exp,
            (select to_char(s, 'YYYY-MM-DD') from p) as f, (select to_char(e, 'YYYY-MM-DD') from p) as t`,
    [await spaceId(kind), basis],
  );
  if (!r) throw new Error('truth');
  return { pemasukan: Number(r.inc), pengeluaran: Number(r.exp), from: r.f, to: r.t };
}

async function catatTipe(page: Page, ruang: 'Pribadi' | 'Bersama', tipe: string) {
  const sheet = page.getByRole('dialog', { name: `Pengeluaran · ${ruang}` });
  await sheet.getByRole('button', { name: `Pengeluaran · ${ruang}` }).click();
  await page.getByRole('menuitemradio', { name: tipe }).click();
}

async function expense(
  page: Page,
  ruang: 'pribadi' | 'bersama',
  amount: number,
  kat: string,
  wallet: string,
) {
  await page.goto(`/${ruang}/beranda`);
  const sheet = await openCatat(page);
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill(String(amount));
  // Dompet eksplisit: dompet bawaan bisa milik spec lain (saldo minus menahan Simpan).
  await sheet.getByLabel('Dari dompet').selectOption({ label: wallet });
  await chipsOf(sheet).filter({ hasText: kat }).first().click();
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page)
      .getByText(/Tersimpan di (Pribadi|Bersama)/)
      .last(),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);
}

test('siapkan data: dua dompet, dua pengeluaran, satu pemasukan, satu transfer', async ({
  page,
}) => {
  await addWallet(page, 'pribadi', W_A, 5_000_000);
  await addWallet(page, 'pribadi', W_B, 100_000);
  await expense(page, 'pribadi', 85_000, KAT_MAKAN, W_A);
  await expense(page, 'pribadi', 40_000, KAT_TRANSPORT, W_A);

  await page.goto('/pribadi/beranda');
  let sheet = await openCatat(page);
  await catatTipe(page, 'Pribadi', 'Pemasukan');
  sheet = page.getByRole('dialog', { name: 'Pemasukan · Pribadi' });
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill('2000000');
  await sheet.getByLabel('Ke dompet').selectOption({ label: W_A });
  await chipsOf(sheet).first().click();
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page)
      .getByText(/Tersimpan di Pribadi/)
      .last(),
  ).toBeVisible();

  await page.goto('/pribadi/beranda');
  await openCatat(page);
  await catatTipe(page, 'Pribadi', 'Transfer');
  sheet = page.getByRole('dialog', { name: 'Transfer · Pribadi' });
  await sheet.getByLabel('Dari dompet').selectOption({ label: W_A });
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill('300000');
  await sheet
    .getByRole('radiogroup', { name: 'Ke dompet' })
    .getByRole('radio', { name: new RegExp(W_B) })
    .click();
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page)
      .getByText(/Tersimpan di Pribadi/)
      .last(),
  ).toBeVisible();
});

/** Awal tiga periode gajian sebelum periode berjalan (p1 = sebelumnya), dari SQL. */
async function pastPeriods(): Promise<{ p1: string; p2: string; p3: string; l1: string }> {
  const [r] = await adminQuery<{ p1: string; p2: string; p3: string; l1: string }>(
    `select to_char((select starts_on from app.period_of_label($1, (q.l - interval '1 month')::date)) + 3, 'YYYY-MM-DD') as p1,
            to_char((select starts_on from app.period_of_label($1, (q.l - interval '2 month')::date)) + 3, 'YYYY-MM-DD') as p2,
            to_char((select starts_on from app.period_of_label($1, (q.l - interval '3 month')::date)) + 3, 'YYYY-MM-DD') as p3,
            to_char(q.l - interval '1 month', 'YYYY-MM') as l1
       from (select label_month as l from app.pay_period($1, app.today())) q`,
    [await spaceId('personal')],
  );
  if (!r) throw new Error('pastPeriods');
  return r;
}

test('siapkan riwayat: pengeluaran di tiga periode lalu (lewat api.create_entry, dicatat mundur)', async () => {
  const { uid, sid } = await spaceOf(OWNER, 'personal');
  const { p1, p2, p3 } = await pastPeriods();
  await asUser(
    uid,
    `select api.create_account(p_client_id => $1, p_space_id => $2, p_name => 'Dompet Laporan Lama',
       p_pocket => 'operasional', p_wallet_type => 'bank', p_opened_on => $3::date,
       p_opening_balance => 1000000::bigint)`,
    [randomUUID(), sid, p3],
  );
  const [ids] = await asUser<{ account: string; expense: string; income: string }>(
    uid,
    `select (select id from app.accounts where space_id = $1 and name = 'Dompet Laporan Lama') as account,
            (select id from app.categories where space_id = $1 and name = 'Langganan') as expense,
            (select id from app.categories where space_id = $1 and type = 'income' and parent_id is null
              order by sort_order limit 1) as income`,
    [sid],
  );
  if (!ids) throw new Error('id');
  const add = (kind: string, amount: number, on: string, cat: string) =>
    asUser(
      uid,
      `select api.create_entry(p_client_id => $1, p_space_id => $2, p_account_id => $3, p_kind => $4::app.entry_kind,
         p_amount => $5::bigint, p_category_id => $6, p_occurred_on => $7::date)`,
      [randomUUID(), sid, ids.account, kind, amount, cat, on],
    );
  await add('expense', 100_000, p3, ids.expense);
  await add('expense', 200_000, p2, ids.expense);
  await add('expense', 500_000, p1, ids.expense);
  await add('income', 3_000_000, p1, ids.income);
});

test('Laporan Pribadi: Ringkasan = SQL, Tidak termasuk, kategori terurut, tren', async ({
  page,
}) => {
  const t = await truth('personal', 'gajian');
  await page.goto('/pribadi/laporan');
  await expect(main(page).getByRole('heading', { level: 1, name: 'Laporan' })).toBeAttached();
  const ring = page.getByTestId('laporan-ringkasan');
  const r = await txt(ring);
  expect(r).toContain(rp(t.pengeluaran));
  expect(r).toContain(`−${rp(t.pengeluaran)}`);
  expect(r).toContain(`+${rp(t.pemasukan)}`);
  expect(r).toContain('Periode belum selesai; angka masih bisa bertambah.');
  const sel = t.pemasukan - t.pengeluaran;
  expect(r).toContain(sel >= 0 ? `+${rp(sel)}` : `−${rp(-sel)}`);
  expect(r).toContain(sel > 0 ? 'Surplus' : sel < 0 ? 'Defisit' : 'Seimbang');

  const excl = page.getByTestId('laporan-tidak-termasuk');
  await expect(excl).toContainText('Transfer antar dompet');
  await expect(excl).toContainText('Pindah antar dompetmu; nilai satu sisi.');
  await expect(excl).not.toContainText('Rp 0');

  const rows = page.getByTestId('laporan-kategori');
  const names = await rows.evaluateAll((els) => els.map((e) => e.textContent.replaceAll(' ', ' ')));
  expect(names.some((n) => n.includes(KAT_MAKAN))).toBe(true);
  expect(names.some((n) => n.includes(KAT_TRANSPORT))).toBe(true);
  // Terurut: nominal induk (muncul pertama sesudah meta persen) tidak naik.
  const amounts = names.map((n) =>
    Number((/dari pengeluaran\s*Rp ([\d.]+)/.exec(n)?.[1] ?? '0').replaceAll('.', '')),
  );
  for (let i = 1; i < amounts.length; i += 1) {
    if (names[i]?.includes('Biaya transfer') || names[i]?.includes('Tanpa kategori')) continue;
    expect(amounts[i]).toBeLessThanOrEqual(amounts[i - 1] ?? Infinity);
  }
  await expect(page.getByTestId('laporan-kategori-kartu')).toContainText('Pemasukan per kategori');

  // Tren: grafik + tabel setara; periode berjalan ditandai; baris berjalan = Ringkasan.
  const tren = page.getByTestId('laporan-tren');
  await expect(tren.getByRole('img', { name: /Grafik batang berpasangan/ })).toHaveCount(1);
  await expect(tren.locator('[data-bar="expense"]')).toHaveCount(4);
  await expect(tren.getByText('berjalan', { exact: true }).first()).toBeVisible();
  await tren.getByText('Tabel data').click();
  const now = tren.getByTestId('laporan-tabel-tren').locator('tr[aria-current="true"]');
  await expect(now).toHaveCount(1);
  expect(await txt(now)).toContain(digits(t.pengeluaran));
});

test('periode lalu (lengkap): pembanding dari SQL dan ringkasan = SQL periode itu', async ({
  page,
}) => {
  const { l1 } = await pastPeriods();
  const [t] = await adminQuery<{ exp: string; inc: string }>(
    `select coalesce((select -sum(amount) from app.report_lines r, app.period_of_label($1, ($2 || '-01')::date) p
                       where r.space_id = $1 and r.occurred_on between p.starts_on and p.ends_on
                         and r.report_class in ('expense','expense_fee')), 0)::text as exp,
            coalesce((select sum(amount) from app.report_lines r, app.period_of_label($1, ($2 || '-01')::date) p
                       where r.space_id = $1 and r.occurred_on between p.starts_on and p.ends_on
                         and r.report_class = 'income'), 0)::text as inc`,
    [await spaceId('personal'), l1],
  );
  await page.goto(`/pribadi/laporan?periode=${l1}&basis=gajian`);
  const r = await txt(page.getByTestId('laporan-ringkasan'));
  expect(r).toContain(rp(Number(t?.exp)));
  expect(r).toContain(`+${rp(Number(t?.inc))}`);
  // p2 punya Rp 200.000, p1 Rp 500.000, p3 (entri tertua) bukan p2: pembanding sah.
  expect(r).toMatch(/Rp 300\.000[\s\S]*lebih banyak dari/);
  await expect(page.getByText('Periode belum selesai')).toHaveCount(0);
});

test('pemilih periode: sebelumnya, dasar kalender, tautan Laporan lengkap', async ({ page }) => {
  await page.goto('/pribadi/laporan');
  await expect(page.getByRole('img', { name: 'Periode berikutnya belum tersedia' })).toBeVisible();
  await page.getByRole('link', { name: /^Periode sebelumnya:/ }).click();
  await expect(page).toHaveURL(/\/pribadi\/laporan\?periode=\d{4}-\d{2}&basis=gajian$/);
  await expect(page.getByText(/· lengkap/)).toBeVisible();
  await expect(page.getByRole('link', { name: /^Periode berikutnya:/ })).toBeVisible();
  await expect(page.getByText('Periode belum selesai')).toHaveCount(0);

  await page.goto('/pribadi/laporan');
  await page.getByRole('link', { name: 'Bulan kalender' }).click();
  await expect(page).toHaveURL(/basis=kalender/);
  await expect(
    page
      .getByRole('navigation', { name: 'Dasar periode' })
      .getByRole('link', { name: 'Bulan kalender' }),
  ).toHaveAttribute('aria-current', 'page');
  const k = await truth('personal', 'kalender');
  const ring = await txt(page.getByTestId('laporan-ringkasan'));
  expect(ring).toContain(rp(k.pengeluaran));
  expect(ring).toContain('Bulan kalender memotong periode gajian');
  // Status anggaran disembunyikan di basis kalender.
  await expect(page.getByTestId('laporan-kategori-kartu')).not.toContainText('dari anggaran');

  // Ringkasan Transaksi memberi tautan ke Laporan bulan itu (kalender).
  await page.goto('/pribadi/transaksi');
  await page.getByRole('link', { name: /Laporan lengkap/ }).click();
  await expect(page).toHaveURL(/\/pribadi\/laporan\?periode=\d{4}-\d{2}&basis=kalender$/);
});

test('parameter rusak atau di luar jangkauan = periode berjalan', async ({ page }) => {
  await page.goto('/pribadi/laporan');
  const base = await page.getByTestId('laporan-ringkasan').textContent();
  for (const q of [
    '?periode=abc&basis=xyz',
    '?periode=2999-01',
    '?periode=1999-12',
    '?periode=2026-13',
    '?periode=2026-10&periode=2026-09',
    '?basis=kalender&basis=gajian',
  ]) {
    const res = await page.goto(`/pribadi/laporan${q}`);
    expect(res?.status(), q).toBe(200);
    if (!q.includes('kalender')) {
      expect(await page.getByTestId('laporan-ringkasan').textContent(), q).toBe(base);
    }
  }
});

test('periode tanpa transaksi: keadaan kosong dengan ajakan Catat, tanpa Rp 0', async ({
  page,
}) => {
  await page.goto('/pribadi/laporan?periode=2020-01');
  await expect(
    main(page).getByRole('heading', { name: 'Belum ada transaksi di periode ini.' }),
  ).toBeVisible();
  await expect(main(page).getByRole('button', { name: 'Catat' })).toBeVisible();
  await expect(page.getByTestId('laporan-ringkasan')).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Periode sebelumnya belum tersedia' })).toBeVisible();
});

test('Rencana = Laporan: realisasi dan persen anggaran sama; tautan Buka di Rencana', async ({
  page,
}) => {
  await page.goto('/pribadi/laporan');
  const row = page.getByTestId('laporan-kategori').filter({ hasText: KAT_TRANSPORT }).first();
  const spent = Number((/Rp ([\d.]+)/.exec(await txt(row))?.[1] ?? '0').replaceAll('.', ''));
  expect(spent).toBeGreaterThanOrEqual(40_000);
  const budget = Math.ceil(spent / 0.85 / 1000) * 1000;
  await page.goto('/pribadi/rencana');
  const sheet = page.getByRole('dialog', { name: /^Anggaran\s*(Pribadi|Bersama)$/ });
  await expect(async () => {
    if ((await sheet.count()) === 0)
      await main(page)
        .getByRole('button', { name: /^Atur anggaran/ })
        .first()
        .click();
    await expect(sheet.getByRole('textbox', { name: 'Anggaran periode ini' })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  await sheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: KAT_TRANSPORT });
  await sheet.getByRole('textbox', { name: 'Anggaran periode ini' }).fill(String(budget));
  await sheet.getByRole('button', { name: 'Simpan anggaran' }).click();
  await expect(
    toasts(page).getByText(`Anggaran ${KAT_TRANSPORT} disimpan · Pribadi`),
  ).toBeVisible();
  const rencana = await txt(
    main(page).locator('[data-budget-row]').filter({ hasText: KAT_TRANSPORT }),
  );

  await page.goto('/pribadi/laporan');
  const item = page.getByTestId('laporan-kategori').filter({ hasText: KAT_TRANSPORT }).first();
  const lap = await txt(item);
  const pct = /(\d+)% terpakai/;
  expect(pct.exec(lap)?.[1]).toBe(pct.exec(rencana)?.[1]);
  expect(lap).toContain(`dari anggaran ${rp(budget)}`);
  expect(rencana).toContain(rp(spent));
  expect(rencana).toContain(`dari ${rp(budget)}`);
  const link = item.getByRole('link', { name: /Buka di Rencana/ });
  await link.click();
  await expect(page).toHaveURL(/\/pribadi\/rencana\?bagian=anggaran/);
});

test('navigasi: Laporan dari Menu (laptop dan HP), tanpa tab aktif, ganti ruang tetap di Laporan', async ({
  page,
}) => {
  // Laptop: sidebar tanpa item Laporan (bundel prototipe tidak boleh bertambah, aturan budget S9 a);
  // Laporan dibuka dari Menu di sidebar, dan tidak ada tab yang tampak aktif.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/pribadi/transaksi');
  const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
  await nav.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Laporan' }).click();
  await expect(page).toHaveURL(/\/pribadi\/laporan$/);
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Ruang' })
    .getByRole('link', { name: 'Bersama' })
    .click();
  await expect(page).toHaveURL(/\/bersama\/laporan$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/pribadi/laporan');
  await expect(
    page.getByRole('navigation', { name: 'Tab utama' }).locator('[aria-current="page"]'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu' }).first().click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Laporan' }).click();
  await expect(page).toHaveURL(/\/pribadi\/laporan$/);
});

test('Bersama: Laporan tanpa data Pribadi (B13) dan tanpa "rumah tangga"', async ({ page }) => {
  await addWallet(page, 'bersama', W_BERSAMA, 1_000_000);
  await expense(page, 'bersama', 60_000, KAT_DAPUR, W_BERSAMA);
  const { bodies, unread } = await bersamaResponses(page, async () => {
    await page.goto('/bersama/laporan');
    await expect(page.getByTestId('laporan-ringkasan')).toContainText('Bersama');
  });
  expect(unread).toEqual([]);
  const all = bodies.join('\n');
  for (const secret of [W_A, W_B, 'Dompet Laporan Lama', 'Pindah antar dompetmu']) {
    expect(all).not.toContain(secret);
  }
  expect(all.toLowerCase()).not.toContain('rumah tangga');
  const t = await truth('shared', 'gajian');
  expect(await txt(page.getByTestId('laporan-ringkasan'))).toContain(rp(t.pengeluaran));
  await expect(page.getByTestId('laporan-kategori').filter({ hasText: KAT_DAPUR })).toBeVisible();
});

test('axe, 320 tanpa gulir samping, dua tema (Pribadi, kalender, Bersama, kosong)', async ({
  page,
}) => {
  test.setTimeout(150_000); // 3 lebar x 2 tema x 4 alamat + axe

  const urls = [
    '/pribadi/laporan',
    '/pribadi/laporan?basis=kalender',
    '/pribadi/laporan?periode=2020-01',
    '/bersama/laporan',
  ];
  for (const [w, h] of [
    [320, 640],
    [390, 844],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const theme of ['dark', 'light']) {
      for (const u of urls) {
        await page.goto(`${u}${u.includes('?') ? '&' : '?'}theme=${theme}`);
        await expect(main(page)).toBeVisible();
        await page
          .getByText('Tabel data')
          .first()
          .click({ timeout: 1_000 })
          .catch(() => undefined);
        await expectNoSeriousViolations(page);
        await noHorizontalScroll(page);
      }
    }
  }
});

test('budget JS: Laporan Pribadi dan Bersama ≤ 162 kB (grafik tanpa JS rute)', async ({
  browser,
  ownerState,
}) => {
  const a = await expectRouteBudget(browser, ownerState, '/pribadi/laporan');
  const b = await expectRouteBudget(browser, ownerState, '/bersama/laporan');
  // Server Component penuh: hampir sama dengan rute lain di bawah shell yang sama.
  expect(Math.abs(a - b)).toBeLessThan(2);
});
