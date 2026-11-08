import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations, WCAG_TAGS } from '../e2e/axe';
import { asUser, noHorizontalScroll, spaceOf } from '../e2e-auth/helpers';
import { adminQuery, expect, OWNER, test } from './fixtures';
import { chipsOf, digits, expectRouteBudget, openCatat, toasts } from './helpers';

/**
 * Kriteria keluar S9 (plan Task 15) satu user, hanya celah yang belum dibuktikan spec Task 10–13:
 * T17 anggaran → Catat → Rencana dan Beranda dalam satu muat ulang (Bersama terpisah); Beranda =
 * Rencana = Laporan sesudah skenario campuran (angka antar layar + SQL `api.*`); tagihan mulai
 * bulan lalu, Lewati menaikkan aman dipakai sebesar nominal, fokus ke baris kemunculan sesudah
 * bayar; keadaan `Lewat batas`; keyboard saja Rencana dan Laporan; axe 768 dan segmen Tagihan +
 * sheet di empat lebar; 320 dengan `Rp 12.345.678.900` dan nama tagihan 60 karakter; periode
 * gajian `payday_rule = 25` (dipulihkan). MENGISI data tanpa membersihkan: project `data`
 * (`playwright.ledger.config.ts`). Nama dompet/tagihan/kategori unik; dompet selalu dipilih
 * eksplisit; angka uang hanya dibaca dari layar atau SQL (JS hanya menjumlah angka tampil untuk
 * identitas antar layar).
 */
test.describe.configure({ mode: 'serial' });

const main = (page: Page) => page.getByRole('main');
const W = 'Dompet Keluar N';
const W2 = 'Dompet Keluar Dua';
const KANTOR = 'Kas Kantor Keluar';
const KAS = 'Kas Keluar Bersama';
const MAKAN = 'Makan Siang & Minum';
const DAPUR = 'Belanja Dapur';
const SEHAT = 'Kesehatan';
const SUB = 'Ojek Keluar';
const BILL_MUKA = 'Tagihan Muka Keluar N';
const BILL_PERIODE = 'Tagihan Periode Keluar N';
const BILL_LALU = 'Tagihan Bulan Lalu N';
/** 60 karakter (batas `bills.name`). */
const BILL_60 = 'Cicilan Kendaraan Roda Empat Keluarga Besar Bulanan Panjang!';
const STRESS = 12_345_678_900;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const amanCard = (page: Page) => page.getByTestId('balance-card');
const budgetsCard = (page: Page) =>
  main(page).getByRole('region', { name: 'Anggaran hampir habis' });
const budgetSheet = (page: Page) =>
  page.getByRole('dialog', { name: /^Anggaran\s*(Pribadi|Bersama)$/ });
const billSheet = (page: Page) =>
  page.getByRole('dialog', { name: /^(Tambah tagihan|Ubah tagihan)\s*(Pribadi|Bersama)$/ });
const paySheet = (page: Page) =>
  page.getByRole('dialog', { name: /^Bayar .+\s(Pribadi|Bersama)$/ });
const payBtn = (page: Page, name: string) =>
  main(page).getByRole('button', { name: new RegExp(`^Bayar ${name}, Rp`) });

/** Teks yang terlihat (tanpa `.sr-only` pembaca layar), spasi dinormalkan. */
async function seen(l: Locator): Promise<string> {
  return l.evaluate((el) => {
    // Simpul teks digabung dengan spasi (span bersebelahan tidak menempel), tanpa `.sr-only`.
    const parts: string[] = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
      if (n.parentElement?.closest('.sr-only')) continue;
      parts.push(n.textContent ?? '');
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  });
}

/** Nominal bertanda pertama di `text` (`−Rp 1.000` = −1000); galat bila tidak ada. */
function money(text: string, re = /(−?)Rp\s?([\d.]+)/): number {
  const m = re.exec(text);
  if (!m?.[2]) throw new Error(`nominal tidak terbaca: ${text}`);
  const n = Number(m[2].replaceAll('.', ''));
  return m[1] === '−' ? -n : n;
}

const dateLabel = (iso: string) => {
  const [, m = '', d = ''] = iso.split('-');
  return `${String(Number(d))} ${MONTHS[Number(m) - 1] ?? ''}`;
};

async function openUntil(open: () => Locator, sheet: Locator, field: Locator) {
  await expect(async () => {
    if ((await sheet.count()) === 0) await open().click();
    await expect(field).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

/**
 * Pulau klien Rencana (baris anggaran, Bayar, Tambah tagihan) dimuat malas (`Suspense` tanpa
 * fallback): tunggu jaringan diam dan tombol pembuka sheet di header/halaman tampil.
 */
async function hydrated(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(
    main(page)
      .getByRole('button', { name: /^(Atur anggaran|Tambah tagihan)/ })
      .or(main(page).locator('[data-budget-row], [data-bill-row]'))
      .first(),
  ).toBeVisible();
}

/** Fokus keyboard sampai `target` (Tab maju, maks `max` kali). */
async function tabTo(page: Page, target: Locator, max = 80, key = 'Tab'): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  await expect(target).toBeFocused();
}

interface Ctx {
  uid: string;
  sid: string;
}
const ctx = async (kind: 'personal' | 'shared'): Promise<Ctx> => spaceOf(OWNER, kind);

interface Period {
  from: string;
  to: string;
  label: string;
  daysLeft: number;
}
/** Periode berjalan dari SQL (`api.pay_period`, sama dengan loader). */
async function period(c: Ctx): Promise<Period> {
  const [p] = await asUser<{ f: string; t: string; l: string; d: number }>(
    c.uid,
    `select to_char(starts_on, 'YYYY-MM-DD') as f, to_char(ends_on, 'YYYY-MM-DD') as t,
            to_char(label_month, 'YYYY-MM-DD') as l, days_left as d
       from api.pay_period($1)`,
    [c.sid],
  );
  if (!p) throw new Error('periode');
  return { from: p.f, to: p.t, label: p.l, daysLeft: p.d };
}

async function idOf(table: 'accounts' | 'categories', c: Ctx, name: string): Promise<string> {
  const [r] = await adminQuery<{ id: string }>(
    `select id::text from app.${table} where space_id = $1 and name = $2 and archived_at is null`,
    [c.sid, name],
  );
  if (!r) throw new Error(`${table} ${name} tidak ada`);
  return r.id;
}

/** Satu baris `api.*` sebagai pemilik (dompetku_web + konteks user, seperti action). */
async function api<T extends Record<string, unknown>>(
  c: Ctx,
  sql: string,
  params: unknown[],
): Promise<T> {
  const [r] = await asUser<T>(c.uid, sql, params);
  if (!r) throw new Error(`tanpa hasil: ${sql}`);
  return r;
}

const expenseApi = (
  c: Ctx,
  account: string,
  amount: number,
  category: string | null,
  extra: { description?: string; reimbursable?: boolean } = {},
) =>
  api<{ id: string }>(
    c,
    `select api.create_entry(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_kind => 'expense', p_amount => $4::bigint, p_category_id => $5, p_description => $6,
       p_reimbursable => $7) ->> 'entry_id' as id`,
    [
      randomUUID(),
      c.sid,
      account,
      amount,
      category,
      extra.description ?? null,
      extra.reimbursable ?? false,
    ],
  );

/** Pengeluaran lewat Catat di `/{ruang}/beranda` (dompet dan chip eksplisit). */
async function catatUi(
  page: Page,
  ruang: 'pribadi' | 'bersama',
  amount: number,
  kat: string,
  wallet: string,
) {
  await page.goto(`/${ruang}/beranda`);
  const sheet = await openCatat(page);
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill(String(amount));
  await sheet.getByLabel('Dari dompet').selectOption({ label: wallet });
  // Chip hanya memuat sebagian kategori (saran + urutan); sisanya lewat `Kategori lain…`.
  const chip = chipsOf(sheet).filter({ hasText: kat }).first();
  if ((await chip.count()) === 0) {
    await sheet.getByRole('button', { name: 'Kategori lain…' }).click();
    // Tampilan cari menggantikan isi sheet (tanpa isian Nominal): cari di halaman.
    await page.getByRole('combobox', { name: 'Cari kategori' }).fill(kat);
    await page.getByRole('option', { name: kat, exact: true }).click();
  } else {
    await chip.click();
  }
  await expect(sheet.getByRole('radio', { name: kat, checked: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page).getByText(
      `Tersimpan di ${ruang === 'pribadi' ? 'Pribadi' : 'Bersama'} · Rp ${digits(amount)} dari ${wallet}`,
    ),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);
}

/** Atur anggaran `name` lewat sheet Rencana (baris yang ada atau tombol Atur + pilih kategori). */
async function setBudgetUi(page: Page, ruang: 'pribadi' | 'bersama', name: string, amount: number) {
  await page.goto(`/${ruang}/rencana`);
  await hydrated(page);
  const existing = main(page).locator('[data-budget-row]').filter({ hasText: name });
  const sheet = budgetSheet(page);
  const field = sheet.getByRole('textbox', { name: 'Anggaran periode ini' });
  if ((await existing.count()) > 0) {
    await openUntil(() => existing.first(), sheet, field);
  } else {
    await openUntil(
      () =>
        main(page)
          .getByRole('button', { name: /^Atur anggaran/ })
          .first(),
      sheet,
      field,
    );
  }
  const combo = sheet.getByRole('combobox', { name: 'Kategori' });
  if ((await combo.count()) > 0) await combo.selectOption({ label: name });
  await field.fill(String(amount));
  await sheet.getByRole('button', { name: 'Simpan anggaran' }).click();
  await expect(
    toasts(page)
      .getByText(`Anggaran ${name} disimpan · ${ruang === 'pribadi' ? 'Pribadi' : 'Bersama'}`)
      .last(),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Baris `api.budget_overview` periode berjalan untuk kategori induk `name`. */
async function overviewOf(c: Ctx, name: string) {
  const p = await period(c);
  return api<{ budget: string | null; spent: string; pct: number | null; remaining: string }>(
    c,
    `select budget::text, spent::text, pct, remaining::text from api.budget_overview($1, $2::date)
      where name = $3`,
    [c.sid, p.label, name],
  );
}

// ---------------------------------------------------------------------------------------------

test('siapkan: dompet operasional, Kas Kantor, Bersama, subkategori (lewat api.*)', async () => {
  const n = await ctx('personal');
  const sh = await ctx('shared');
  const acc = (c: Ctx, name: string, pocket: string, opening: number) =>
    asUser(
      c.uid,
      `select api.create_account(p_client_id => $1, p_space_id => $2, p_name => $3,
         p_pocket => $4::app.pocket, p_wallet_type => 'bank', p_opening_balance => $5::bigint)`,
      [randomUUID(), c.sid, name, pocket, opening],
    );
  await acc(n, W, 'operasional', 5_000_000);
  await acc(n, W2, 'operasional', 0);
  await acc(n, KANTOR, 'kantor', 500_000);
  await acc(sh, KAS, 'operasional', 1_000_000);
  await asUser(
    n.uid,
    `select api.create_category(p_client_id => $1, p_space_id => $2, p_type => 'expense',
       p_name => $3, p_icon => 'Motorcycle', p_parent_id => $4)`,
    [randomUUID(), n.sid, SUB, await idOf('categories', n, 'Transportasi')],
  );
});

test(
  'anggaran → Catat → Rencana dan Beranda menampilkan realisasi baru dalam satu muat ulang; Bersama terpisah',
  { tag: ['@T17'] },
  async ({ page }) => {
    test.setTimeout(120_000);
    const n = await ctx('personal');
    const sh = await ctx('shared');
    const row = (name: string) => main(page).locator('[data-budget-row]').filter({ hasText: name });

    // Pribadi: Rp 2.000.000 lalu catat Rp 48.500 lewat Catat.
    await setBudgetUi(page, 'pribadi', MAKAN, 2_000_000);
    const before = await overviewOf(n, MAKAN);
    expect(before.budget).toBe('2000000');
    await catatUi(page, 'pribadi', 48_500, MAKAN, W);
    const after = await overviewOf(n, MAKAN);
    expect(Number(after.spent) - Number(before.spent)).toBe(48_500);
    await page.goto('/pribadi/rencana');
    const text = await seen(row(MAKAN));
    expect(text).toContain(`Rp ${digits(Number(after.spent))} dari Rp 2.000.000`);
    expect(text).toContain(`${String(after.pct)}% terpakai`);

    // Beranda hanya menampilkan anggaran ≥ 80%: atur ulang supaya sekitar 90% sesudah catatan
    // kedua, lalu satu muat ulang Beranda dan satu muat Rencana menampilkan angka baru (SQL).
    const target = Math.ceil((Number(after.spent) + 48_500) / 0.9 / 1000) * 1000;
    await setBudgetUi(page, 'pribadi', MAKAN, target);
    await catatUi(page, 'pribadi', 48_500, MAKAN, W);
    const final = await overviewOf(n, MAKAN);
    expect(Number(final.spent) - Number(after.spent)).toBe(48_500);
    expect(final.pct).toBeGreaterThanOrEqual(80);
    await page.reload();
    const li = budgetsCard(page).locator('li').filter({ hasText: MAKAN });
    const home = await seen(li);
    expect(home).toContain(`${String(final.pct)}% terpakai`);
    expect(home).toContain(`Rp ${digits(Number(final.spent))}`);
    expect(home).toContain(`dari Rp ${digits(target)}`);
    expect(home).toContain(`sisa Rp ${digits(Number(final.remaining))}`);
    await page.goto('/pribadi/rencana');
    expect(await seen(row(MAKAN))).toContain(
      `Rp ${digits(Number(final.spent))} dari Rp ${digits(target)}`,
    );

    // Bersama: anggaran sendiri; catatan Bersama tidak menggeser Pribadi dan sebaliknya.
    await setBudgetUi(page, 'bersama', DAPUR, 1_000_000);
    await expect(main(page)).not.toContainText(MAKAN);
    await expect(main(page)).not.toContainText(digits(target));
    const dapur0 = await overviewOf(sh, DAPUR);
    await catatUi(page, 'bersama', 30_000, DAPUR, KAS);
    const dapur1 = await overviewOf(sh, DAPUR);
    expect(Number(dapur1.spent) - Number(dapur0.spent)).toBe(30_000);
    expect((await overviewOf(n, MAKAN)).spent).toBe(final.spent);
    await page.goto('/bersama/rencana');
    expect(await seen(row(DAPUR))).toContain(
      `Rp ${digits(Number(dapur1.spent))} dari Rp 1.000.000`,
    );
    await page.goto('/pribadi/rencana');
    await expect(main(page)).not.toContainText(DAPUR);
    const rows = await adminQuery<{ kind: string; name: string }>(
      `select s.kind::text as kind, c.name from app.budgets b
         join app.spaces s on s.id = b.space_id join app.categories c on c.id = b.category_id
        where c.name in ($1, $2) order by 1`,
      [MAKAN, DAPUR],
    );
    expect(rows).toEqual([
      { kind: 'personal', name: MAKAN },
      { kind: 'shared', name: DAPUR },
    ]);
  },
);

/** Angka Rencana > Anggaran yang tampil: realisasi per kategori induk dan sisa wajib. */
async function rencanaNumbers(page: Page, ruang: 'pribadi' | 'bersama') {
  await page.goto(`/${ruang}/rencana`);
  await hydrated(page);
  await expect(main(page).locator('[data-budget-row]').first()).toBeVisible();
  const spent = new Map<string, number>();
  let wajibSisa = 0;
  const budgeted = main(page)
    .getByRole('region', { name: 'Dianggarkan', exact: true })
    .locator('[data-budget-row]');
  for (const r of await budgeted.all()) {
    const t = await seen(r);
    const name = (await r.locator('.truncate').first().textContent())?.trim() ?? '';
    spent.set(name, money(t, /(−?)Rp\s?([\d.]+) dari Rp/));
    if (` ${t} `.includes(' Wajib ') && t.includes('sisa')) {
      wajibSisa += money(t, /sisa (−?)Rp\s?([\d.]+)/);
    }
  }
  const unbudgeted = main(page)
    .getByRole('region', { name: 'Belum dianggarkan' })
    .locator('[data-budget-row]');
  for (const r of await unbudgeted.all()) {
    const t = await seen(r);
    const name = (await r.locator('.truncate').first().textContent())?.trim() ?? '';
    spent.set(name, t.includes('periode ini') ? money(t, /(−?)Rp\s?([\d.]+) periode ini/) : 0);
  }
  return { spent, wajibSisa };
}

/** Jumlah `Bayar …, Rp X` di kelompok Lewat jatuh tempo + Periode ini (kemunculan terbuka). */
async function openBillsTotal(page: Page, ruang: 'pribadi' | 'bersama'): Promise<number> {
  await page.goto(`/${ruang}/rencana?bagian=tagihan`);
  await hydrated(page);
  let total = 0;
  for (const group of ['Lewat jatuh tempo', 'Periode ini']) {
    const region = main(page).getByRole('region', { name: group, exact: true });
    if ((await region.count()) === 0) continue;
    const labels = await region
      .getByRole('button', { name: /^Bayar .+, Rp/ })
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    for (const l of labels) total += money(l, /, (−?)Rp\s?([\d.]+)$/);
  }
  return total;
}

/** Laporan periode berjalan: Pengeluaran Ringkasan dan baris pengeluaran per kategori induk. */
async function laporanNumbers(page: Page, ruang: 'pribadi' | 'bersama') {
  await page.goto(`/${ruang}/laporan`);
  const ring = page.getByTestId('laporan-ringkasan');
  const dd = ring
    .locator('div')
    .filter({ has: page.locator('dt', { hasText: /^Pengeluaran$/ }) })
    .locator('dd');
  const pengeluaran = 0 - money(await seen(dd));
  const rows = new Map<string, number>();
  const items = page.getByTestId('laporan-kategori').filter({ hasText: 'dari pengeluaran' });
  for (const li of await items.all()) {
    const name = (await li.locator('span.text-body').first().textContent())?.trim() ?? '';
    rows.set(name, money(await seen(li.locator('span.num').first())));
  }
  return { pengeluaran, rows };
}

/** Angka rincian kartu Aman dipakai yang tampil. */
async function berandaNumbers(page: Page, ruang: 'pribadi' | 'bersama') {
  await page.goto(`/${ruang}/beranda`);
  const card = amanCard(page);
  await expect(card).toBeVisible();
  // Baris Tagihan/Sisa wajib hanya ada bila ruang punya kewajiban periode ini (= 0).
  const cell = async (name: RegExp) => {
    const th = card.getByRole('rowheader', { name });
    if ((await th.count()) === 0) return 0;
    return money(await seen(th.locator('xpath=..').locator('td')));
  };
  return {
    operasional: await cell(/^Saldo operasional$/),
    tagihan: 0 - (await cell(/^Tagihan s\.d\./)),
    wajib: 0 - (await cell(/^Sisa anggaran wajib$/)),
    hero: money(await seen(card.getByTestId('hero-amount'))),
    total: await cell(/^Aman dipakai$/),
  };
}

/**
 * Selisih sah Rencana vs Laporan dari SQL mentah (bukan fungsi yang diuji): bayar tagihan yang
 * kemunculannya jatuh tempo di luar periode pada kategori beranggaran wajib (realisasi wajib tidak
 * menghitungnya, review Task 7) dan kategori induk terarsip tanpa anggaran (tidak tampil di Rencana).
 */
async function legitimateGap(c: Ctx, p: Period): Promise<{ wajibOther: number; archived: number }> {
  const [r] = await adminQuery<{ w: string; a: string }>(
    `select coalesce((select -sum(rl.amount) from app.report_lines rl
                       join app.bill_occurrences o on o.entry_id = rl.entry_id
                       join app.budgets b on b.space_id = rl.space_id
                        and b.category_id = rl.root_category_id and b.month = $4::date and b.wajib
                      where rl.space_id = $1 and rl.report_class = 'expense'
                        and rl.occurred_on between $2::date and $3::date
                        and o.due_on not between $2::date and $3::date), 0)::text as w,
            coalesce((select -sum(rl.amount) from app.report_lines rl
                       join app.categories c on c.id = rl.root_category_id
                      where rl.space_id = $1 and rl.report_class = 'expense'
                        and rl.occurred_on between $2::date and $3::date
                        and c.archived_at is not null
                        and not exists (select 1 from app.budgets b where b.category_id = c.id
                                         and b.month = $4::date)), 0)::text as a`,
    [c.sid, p.from, p.to, p.label],
  );
  return { wajibOther: Number(r?.w ?? 0), archived: Number(r?.a ?? 0) };
}

test('skenario campuran: Beranda = Rencana = Laporan (layar dan SQL), Pribadi dan Bersama', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const n = await ctx('personal');
  const sh = await ctx('shared');
  const p = await period(n);
  const w = await idOf('accounts', n, W);
  const w2 = await idOf('accounts', n, W2);
  const kantor = await idOf('accounts', n, KANTOR);
  const kas = await idOf('accounts', sh, KAS);
  const sehat = await idOf('categories', n, SEHAT);
  const trf = (from: string, to: string, amount: number, fee: number) =>
    api(
      n,
      `select api.create_transfer(p_client_id => $1, p_space_id => $2, p_from_account => $3,
         p_to_account => $4, p_amount => $5::bigint, p_fee => $6::bigint) ->> 'entry_id' as id`,
      [randomUUID(), n.sid, from, to, amount, fee],
    );

  // Pengeluaran biasa, subkategori, tanpa kategori, Kas Kantor + biaya, transfer + biaya,
  // talangan, setor Bersama + biaya, pemasukan, entri batal.
  await expenseApi(n, w, 120_000, await idOf('categories', n, 'Belanja'));
  await expenseApi(n, w, 45_000, await idOf('categories', n, SUB));
  await expenseApi(n, w, 15_000, null, { description: 'Tanpa kategori keluar' });
  await expenseApi(n, kantor, 50_000, await idOf('categories', n, MAKAN));
  await trf(kantor, w, 250_000, 1_000);
  await trf(w, w2, 100_000, 2_500);
  await expenseApi(n, w, 200_000, await idOf('categories', n, MAKAN), { reimbursable: true });
  await trf(w, kas, 400_000, 6_500);
  await api(
    n,
    `select api.create_entry(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_kind => 'income', p_amount => 1000000, p_category_id => $4) ->> 'entry_id' as id`,
    [randomUUID(), n.sid, w, await idOf('categories', n, 'Gaji')],
  );
  const batal = await expenseApi(n, w, 99_000, await idOf('categories', n, 'Hiburan'));
  await api(n, `select api.void_entry($1, $2, 1) ->> 'entry_id' as id`, [randomUUID(), batal.id]);

  // Anggaran wajib Kesehatan + tagihan Kesehatan yang baru mulai periode berikutnya, dibayar di
  // muka hari ini (bukan kewajiban ganda: tidak ada kemunculan di periode ini).
  await api(n, `select true as x from api.set_budget($1, $2, $3::date, 300000, true)`, [
    n.sid,
    sehat,
    p.label,
  ]);
  await expenseApi(n, w, 64_000, sehat);
  const muka = await api<{ id: string }>(
    n,
    `select api.create_bill(p_client_id => $1, p_space_id => $2, p_name => $3, p_amount => 77000,
       p_category_id => $4, p_day_of_month => 5::smallint, p_starts_on => $5::date + 1) ->> 'bill_id' as id`,
    [randomUUID(), n.sid, BILL_MUKA, sehat, p.to],
  );
  const [occ] = await adminQuery<{ id: string }>(
    'select id::text from app.bill_occurrences where bill_id = $1 order by due_on limit 1',
    [muka.id],
  );
  await api(
    n,
    `select api.post_bill_occurrence(p_client_id => $1, p_occurrence_id => $2, p_account_id => $3)
       ->> 'entry_id' as id`,
    [randomUUID(), occ?.id, w],
  );
  // Tagihan periode ini (belum dibayar) untuk baris Tagihan di Beranda.
  await api(
    n,
    `select api.create_bill(p_client_id => $1, p_space_id => $2, p_name => $3, p_amount => 55000,
       p_category_id => $4, p_day_of_month => extract(day from $5::date)::smallint,
       p_starts_on => $6::date) ->> 'bill_id' as id`,
    [
      randomUUID(),
      n.sid,
      BILL_PERIODE,
      await idOf('categories', n, 'Cicilan & Tagihan'),
      p.to,
      p.from,
    ],
  );
  // Bersama: pengeluaran N dari Kas Bersama.
  await expenseApi(sh, kas, 90_000, await idOf('categories', sh, DAPUR));

  for (const [ruang, c] of [
    ['pribadi', n],
    ['bersama', sh],
  ] as const) {
    const per = await period(c);
    const rencana = await rencanaNumbers(page, ruang);
    const laporan = await laporanNumbers(page, ruang);
    const beranda = await berandaNumbers(page, ruang);
    const bills = await openBillsTotal(page, ruang);

    // Laporan = SQL (period_trend periode berjalan, basis gajian = basis loader).
    const [trend] = await asUser<{ pengeluaran: string }>(
      c.uid,
      `select pengeluaran::text from api.period_trend($1, $2::date, 1, 'gajian') where is_current`,
      [c.sid, per.label],
    );
    expect(laporan.pengeluaran, `${ruang} Laporan = period_trend`).toBe(Number(trend?.pengeluaran));
    // Σ baris kategori Laporan = Pengeluaran (biaya dan tanpa kategori termasuk).
    const sumRows = [...laporan.rows.values()].reduce((a, b) => a + b, 0);
    expect(sumRows, `${ruang} Σ kategori Laporan`).toBe(laporan.pengeluaran);

    // Pengeluaran Laporan = Σ realisasi Rencana (dianggarkan + belum) + Biaya transfer + Tanpa
    // kategori + selisih sah dari SQL mentah.
    const sumRencana = [...rencana.spent.values()].reduce((a, b) => a + b, 0);
    const gap = await legitimateGap(c, per);
    // Skenario ini tidak mengarsipkan kategori induk yang punya pengeluaran periode ini, jadi
    // selisih arsip harus nol; bila suatu saat bukan nol, persamaan di bawah tidak lagi menguji
    // apa-apa untuk cabang itu dan skenario perlu diperbarui dengan sengaja.
    expect(gap.archived, `${ruang} selisih kategori arsip`).toBe(0);
    const fee = laporan.rows.get('Biaya transfer') ?? 0;
    const none = laporan.rows.get('Tanpa kategori') ?? 0;
    expect(
      laporan.pengeluaran,
      `${ruang} Laporan = Rencana + biaya + tanpa kategori + selisih`,
    ).toBe(sumRencana + fee + none + gap.wajibOther + gap.archived);
    // Per kategori: Rencana = Laporan, kecuali kategori wajib yang dibayar tagihan periode lain.
    for (const [name, amount] of rencana.spent) {
      if (ruang === 'pribadi' && name === SEHAT) continue;
      expect(laporan.rows.get(name) ?? 0, `${ruang} ${name}`).toBe(amount);
    }

    // Beranda: Saldo operasional − Tagihan − Sisa wajib = angka besar = baris total = SQL.
    expect(beranda.operasional - beranda.tagihan - beranda.wajib, `${ruang} rincian`).toBe(
      beranda.hero,
    );
    expect(beranda.total).toBe(beranda.hero);
    const [safe] = await asUser<Record<string, string>>(
      c.uid,
      `select operasional::text as o, bills_until_eom::text as b, budget_wajib_remaining::text as w,
              total::text as t from api.safe_to_spend($1)`,
      [c.sid],
    );
    expect(beranda).toEqual({
      operasional: Number(safe?.o),
      tagihan: Number(safe?.b),
      wajib: Number(safe?.w),
      hero: Number(safe?.t),
      total: Number(safe?.t),
    });
    // Beranda = Rencana: Tagihan = Σ kemunculan terbuka s.d. akhir periode; Sisa wajib = Σ sisa
    // baris wajib.
    expect(beranda.tagihan, `${ruang} Tagihan = Rencana`).toBe(bills);
    expect(beranda.wajib, `${ruang} Sisa wajib = Rencana`).toBe(rencana.wajibSisa);

    if (ruang === 'pribadi') {
      // Skenario benar-benar memuat semua jenis: biaya, tanpa kategori, bayar di muka wajib.
      expect(fee).toBeGreaterThanOrEqual(2_500 + 6_500);
      expect(none).toBeGreaterThanOrEqual(15_000);
      expect(gap.wajibOther).toBeGreaterThanOrEqual(77_000);
      expect(rencana.spent.get(SEHAT)).toBe(64_000);
      expect(laporan.rows.get(SEHAT)).toBe(64_000 + 77_000);
      expect(beranda.tagihan).toBeGreaterThanOrEqual(55_000);
      expect(beranda.wajib).toBeGreaterThanOrEqual(300_000 - 64_000);

      // Kartu Beranda `Anggaran hampir habis` = Laporan per kategori: Makan Siang & Minum tidak
      // wajib, jadi terpakai harus sama persis. Baris tampil karena tes anggaran di atas mengatur
      // ±90% dan skenario ini menambah Rp 250.000 lagi (pct hanya naik; dijaga SQL di bawah).
      expect((await overviewOf(n, MAKAN)).pct).toBeGreaterThanOrEqual(80);
      await page.goto('/pribadi/beranda');
      const li = budgetsCard(page).locator('li').filter({ hasText: MAKAN });
      await expect(li).toBeVisible();
      expect(money(await seen(li), /(−?)Rp\s?([\d.]+) dari Rp/), 'Beranda = Laporan').toBe(
        laporan.rows.get(MAKAN),
      );
    }
  }
});

test('tagihan mulai bulan lalu: hanya bulan ini ditagih; Lewati menaikkan aman dipakai sebesar nominal; fokus ke baris sesudah bayar', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const [t] = await adminQuery<{ month0: string; prev: string }>(
    `select to_char(date_trunc('month', app.today()), 'YYYY-MM-DD') as month0,
            to_char(date_trunc('month', app.today()) - interval '1 month', 'YYYY-MM-DD') as prev`,
  );
  if (!t) throw new Error('today');
  await page.goto('/pribadi/rencana?bagian=tagihan');
  const sheet = billSheet(page);
  await openUntil(
    () => main(page).getByRole('button', { name: 'Tambah tagihan' }).first(),
    sheet,
    sheet.getByRole('textbox', { name: 'Nama' }),
  );
  await sheet.getByRole('textbox', { name: 'Nama' }).fill(BILL_LALU);
  await sheet.getByRole('textbox', { name: 'Perkiraan nominal' }).fill('66000');
  await sheet.getByRole('combobox', { name: 'Kategori' }).selectOption({ label: 'Langganan' });
  await sheet.getByRole('combobox', { name: 'Tanggal tiap bulan' }).selectOption('3');
  await sheet.getByRole('combobox', { name: 'Dompet bayar bawaan' }).selectOption({ label: W });
  await sheet.getByLabel('Mulai').fill(t.prev);
  await expect(sheet.getByText(/^Bulan sebelum \w+ tidak ditagih\.$/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Simpan tagihan' }).click();
  await expect(toasts(page).getByText(`Tagihan ${BILL_LALU} disimpan · Pribadi`)).toBeVisible();

  // Tidak ada kemunculan bulan lalu: yang pertama tanggal 3 bulan ini.
  const occs = await adminQuery<{ due: string }>(
    `select to_char(o.due_on, 'YYYY-MM-DD') as due from app.bill_occurrences o
       join app.bills b on b.id = o.bill_id where b.name = $1 order by o.due_on`,
    [BILL_LALU],
  );
  expect(occs[0]?.due).toBe(`${t.month0.slice(0, 8)}03`);
  expect(occs.every((o) => o.due >= t.month0)).toBe(true);
  await expect(
    main(page).locator('[data-bill-row]').filter({ hasText: BILL_LALU }).first(),
  ).toBeVisible();

  // Lewati: aman dipakai naik sebesar nominal (dibaca dari layar), tagihan turun sama besar.
  const before = await berandaNumbers(page, 'pribadi');
  await page.goto('/pribadi/rencana?bagian=tagihan');
  const pay = paySheet(page);
  await openUntil(
    () => payBtn(page, BILL_LALU).first(),
    pay,
    pay.getByRole('button', { name: 'Lewati tagihan ini' }),
  );
  await pay.getByRole('button', { name: 'Lewati tagihan ini' }).click();
  await expect(toasts(page).getByText(`${BILL_LALU} dilewati · Pribadi`)).toBeVisible();
  const skipped = await berandaNumbers(page, 'pribadi');
  expect(skipped.hero - before.hero).toBe(66_000);
  expect(before.tagihan - skipped.tagihan).toBe(66_000);
  expect(skipped.operasional).toBe(before.operasional);

  // Batalkan lewati, lalu bayar: fokus pindah ke baris kemunculan yang dibayar (bukan <body>).
  await page.goto('/pribadi/rencana?bagian=tagihan');
  await main(page)
    .getByRole('button', { name: `Batalkan lewati ${BILL_LALU}` })
    .first()
    .click();
  await expect(toasts(page).getByText(`${BILL_LALU} kembali ditagih · Pribadi`)).toBeVisible();
  expect((await berandaNumbers(page, 'pribadi')).hero).toBe(before.hero);
  const [o] = await adminQuery<{ id: string }>(
    `select o.id::text from app.bill_occurrences o join app.bills b on b.id = o.bill_id
      where b.name = $1 order by o.due_on limit 1`,
    [BILL_LALU],
  );
  await page.goto('/pribadi/rencana?bagian=tagihan');
  await openUntil(
    () => payBtn(page, BILL_LALU).first(),
    pay,
    pay.getByRole('textbox', { name: 'Nominal' }),
  );
  // Dompet bawaan tagihan terpilih (dompet eksplisit, bukan dompet pertama).
  await expect(pay.getByRole('combobox', { name: 'Dompet' }).locator('option:checked')).toHaveText(
    W,
  );
  await pay.getByRole('button', { name: /^Bayar Rp\s66\.000$/ }).click();
  await expect(toasts(page).getByText(`Tagihan ${BILL_LALU} dibayar di Pribadi`)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-occ-row') ?? null))
    .toBe(o?.id);
  await expect(page.locator(`[data-occ-row="${o?.id ?? ''}"]`)).toContainText(/Lunas · /);
});

test('keyboard saja: Rencana (segmen → Atur → simpan; Bayar → konfirmasi) dan Laporan', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/pribadi/rencana?bagian=tagihan');
  await hydrated(page);
  const segAnggaran = main(page)
    .getByRole('navigation', { name: 'Bagian Rencana' })
    .getByRole('link', { name: 'Anggaran' });
  await tabTo(page, segAnggaran);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/pribadi\/rencana$/);
  await hydrated(page);
  const rowMakan = main(page)
    .getByRole('region', { name: 'Dianggarkan', exact: true })
    .locator('[data-budget-row]')
    .filter({ hasText: MAKAN });
  await tabTo(page, rowMakan);
  await page.keyboard.press('Enter');
  const field = budgetSheet(page).getByRole('textbox', { name: 'Anggaran periode ini' });
  await expect(field).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('3000000');
  await expect(field).toHaveValue('3.000.000');
  await tabTo(page, budgetSheet(page).getByRole('button', { name: 'Simpan anggaran' }), 20);
  await page.keyboard.press('Enter');
  await expect(toasts(page).getByText(`Anggaran ${MAKAN} disimpan · Pribadi`)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(rowMakan).toContainText('dari Rp 3.000.000');

  // Bayar: segmen Tagihan, tombol Bayar, sheet (dompet bawaan tagihan), Bayar.
  const segTagihan = main(page)
    .getByRole('navigation', { name: 'Bagian Rencana' })
    .getByRole('link', { name: 'Tagihan' });
  await tabTo(page, segTagihan, 80, 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/bagian=tagihan$/);
  await hydrated(page);
  const next = payBtn(page, BILL_LALU).first();
  await tabTo(page, next);
  await page.keyboard.press('Enter');
  const pay = paySheet(page);
  await expect(pay.getByRole('textbox', { name: 'Nominal' })).toBeFocused();
  await tabTo(page, pay.getByRole('button', { name: /^Bayar Rp/ }), 20);
  await page.keyboard.press('Enter');
  await expect(toasts(page).getByText(`Tagihan ${BILL_LALU} dibayar di Pribadi`)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName ?? 'BODY'))
    .not.toBe('BODY');

  // Laporan: buka sub kategori (details) lalu pindah periode, keyboard saja.
  await page.goto('/pribadi/laporan');
  const transport = page
    .getByTestId('laporan-kategori')
    .filter({ hasText: 'Transportasi' })
    .locator('details');
  const summary = transport.locator('summary');
  await tabTo(page, summary);
  await page.keyboard.press('Enter');
  await expect(transport).toHaveAttribute('open', '');
  await expect(transport).toContainText(SUB);
  await page.goto('/pribadi/laporan');
  await tabTo(page, page.getByRole('link', { name: /^Periode sebelumnya:/ }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/pribadi\/laporan\?periode=\d{4}-\d{2}&basis=gajian$/);
  await tabTo(page, page.getByRole('link', { name: 'Bulan kalender' }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/basis=kalender/);
});

test('Lewat batas (total < 0): ikon + teks; 320 tanpa gulir dengan Rp 12.345.678.900 dan nama 60 karakter', async ({
  page,
}) => {
  test.setTimeout(150_000);
  expect(BILL_60).toHaveLength(60);
  const n = await ctx('personal');
  const p = await period(n);
  const bill = await api<{ id: string }>(
    n,
    `select api.create_bill(p_client_id => $1, p_space_id => $2, p_name => $3, p_amount => $4::bigint,
       p_category_id => $5, p_day_of_month => 1::smallint, p_starts_on => $6::date) ->> 'bill_id' as id`,
    [
      randomUUID(),
      n.sid,
      BILL_60,
      STRESS,
      await idOf('categories', n, 'Cicilan & Tagihan'),
      p.from,
    ],
  );
  let entry: string | null = null;
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/pribadi/beranda');
    const status = amanCard(page).getByTestId('aman-status');
    await expect(status).toContainText('Lewat batas');
    await expect(status).toContainText('Pengeluaran wajib periode ini melebihi saldo operasional.');
    await expect(status.locator('svg')).toHaveCount(1);
    await expect(status).not.toContainText('Hati-hati');
    // Tanpa baris per hari; angka besar bertanda minus.
    await expect(amanCard(page).getByText(/per hari untuk/)).toHaveCount(0);
    expect(money(await seen(amanCard(page).getByTestId('hero-amount')))).toBeLessThan(0);
    await expect(
      amanCard(page).getByRole('img', { name: /melebihi saldo operasional\.$/ }),
    ).toBeVisible();

    await page.setViewportSize({ width: 320, height: 640 });
    for (const url of ['/pribadi/beranda', '/pribadi/rencana?bagian=tagihan']) {
      await page.goto(url);
      if (url.includes('rencana')) await expect(main(page)).toContainText(BILL_60);
      await expect(main(page)).toContainText(/12\.345\.\d{3}\.\d{3}/);
      await noHorizontalScroll(page);
    }
    // Laporan: bayar (saldo minus diizinkan) supaya kategori memuat 12 digit; lalu dibatalkan.
    const [o] = await adminQuery<{ id: string }>(
      'select id::text from app.bill_occurrences where bill_id = $1 order by due_on limit 1',
      [bill.id],
    );
    entry = (
      await api<{ id: string }>(
        n,
        `select api.post_bill_occurrence(p_client_id => $1, p_occurrence_id => $2, p_account_id => $3,
           p_allow_negative => true) ->> 'entry_id' as id`,
        [randomUUID(), o?.id, await idOf('accounts', n, W)],
      )
    ).id;
    for (const theme of ['dark', 'light']) {
      await page.goto(`/pribadi/laporan?theme=${theme}`);
      await expect(page.getByTestId('laporan-kategori-kartu')).toContainText(
        /12\.345\.\d{3}\.\d{3}/,
      );
      await noHorizontalScroll(page);
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
    }
  } finally {
    if (entry !== null) {
      await api(n, `select api.void_entry($1, $2, 1) ->> 'entry_id' as id`, [randomUUID(), entry]);
    }
    await api(n, `select api.archive_bill($1) ->> 'bill_id' as id`, [bill.id]);
  }
  await page.goto('/pribadi/beranda');
  await expect(amanCard(page).getByTestId('aman-status')).not.toContainText('Lewat batas');
});

test('axe 0 serious/critical: 768 untuk Beranda, Rencana, Laporan; segmen Tagihan + sheet di 320/390/768/1280', async ({
  page,
}) => {
  test.setTimeout(300_000);
  for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width: 768, height: 1000 });
    for (const url of [
      '/pribadi/beranda',
      '/bersama/beranda',
      '/pribadi/rencana',
      '/bersama/rencana',
      '/pribadi/laporan',
      '/bersama/laporan',
    ]) {
      await page.goto(`${url}?theme=${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(main(page)).toBeVisible();
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      await noHorizontalScroll(page);
    }
    for (const [width, height] of [
      [320, 640],
      [390, 844],
      [768, 1000],
      [1280, 800],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`/pribadi/rencana?bagian=tagihan&theme=${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(payBtn(page, BILL_PERIODE).first()).toBeVisible();
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      await noHorizontalScroll(page);
      const pay = paySheet(page);
      await openUntil(
        () => payBtn(page, BILL_PERIODE).first(),
        pay,
        pay.getByRole('textbox', { name: 'Nominal' }),
      );
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const edit = billSheet(page);
      await openUntil(
        () => main(page).locator('[data-bill-row]').filter({ hasText: BILL_PERIODE }).first(),
        edit,
        edit.getByRole('textbox', { name: 'Perkiraan nominal' }),
      );
      await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      if (width === 768) {
        await page.goto(`/pribadi/rencana?theme=${theme}`);
        await openUntil(
          () => main(page).locator('[data-budget-row]').filter({ hasText: MAKAN }).first(),
          budgetSheet(page),
          budgetSheet(page).getByRole('textbox', { name: 'Anggaran periode ini' }),
        );
        await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
        await page.keyboard.press('Escape');
      }
    }
  }
});

test('periode gajian payday_rule = 25: Beranda, Rencana, dan Laporan memakai app.pay_period yang sama', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const n = await ctx('personal');
  const [h] = await adminQuery<{ rule: number | null }>(
    `select h.payday_rule as rule from app.households h join app.spaces s on s.household_id = h.id
      where s.id = $1`,
    [n.sid],
  );
  const asli = h?.rule ?? null;
  const kalender = await period(n);
  await adminQuery(
    `update app.households set payday_rule = 25
      where id = (select household_id from app.spaces where id = $1)`,
    [n.sid],
  );
  try {
    const p = await period(n);
    // Periode gajian tidak sama dengan bulan kalender (hari gajian 25, digeser akhir pekan/libur
    // oleh SQL), jadi asersi di bawah membedakan keduanya.
    expect(p.from).not.toBe(kalender.from);
    const [eff] = await adminQuery<{ d: string }>(
      `select to_char(app.effective_payday(25::smallint, ($1::date - interval '1 month')::date),
                      'YYYY-MM-DD') as d`,
      [p.label],
    );
    expect(p.from).toBe(eff?.d);
    const range = `${dateLabel(p.from)} – ${dateLabel(p.to)}`;
    const sub = `${range} · berjalan, ${String(p.daysLeft)} hari lagi`;

    await page.goto('/pribadi/beranda');
    await expect(
      amanCard(page).getByRole('heading', { name: `Aman dipakai sampai ${dateLabel(p.to)}` }),
    ).toBeVisible();
    await expect(
      amanCard(page).getByRole('rowheader', { name: `Tagihan s.d. ${dateLabel(p.to)}` }),
    ).toBeVisible();
    const [safe] = await asUser<{ t: string; d: number; u: string }>(
      n.uid,
      `select total::text as t, days_left as d, to_char(until, 'YYYY-MM-DD') as u
         from api.safe_to_spend($1)`,
      [n.sid],
    );
    expect(safe?.u).toBe(p.to);
    expect(money(await seen(amanCard(page).getByTestId('hero-amount')))).toBe(Number(safe?.t));
    await expect(amanCard(page)).toContainText(`per hari untuk ${String(safe?.d)} hari`);

    await page.goto('/pribadi/rencana');
    await expect(main(page).getByText(sub, { exact: true })).toBeVisible();
    // Realisasi periode gajian dari SQL (label bisa tanpa anggaran bila gajian sudah lewat).
    const o = await overviewOf(n, MAKAN);
    const makan = await seen(main(page).locator('[data-budget-row]').filter({ hasText: MAKAN }));
    expect(makan).toContain(
      o.spent === '0' && o.budget === null
        ? 'Belum ada pengeluaran'
        : `Rp ${digits(Number(o.spent))}`,
    );

    await page.goto('/pribadi/laporan');
    await expect(page.getByRole('navigation', { name: 'Pilih periode' })).toContainText(sub);
    const [trend] = await asUser<{ x: string; f: string; t: string }>(
      n.uid,
      `select pengeluaran::text as x, to_char(starts_on, 'YYYY-MM-DD') as f,
              to_char(ends_on, 'YYYY-MM-DD') as t
         from api.period_trend($1, $2::date, 1, 'gajian') where is_current`,
      [n.sid, p.label],
    );
    expect([trend?.f, trend?.t]).toEqual([p.from, p.to]);
    expect((await laporanNumbers(page, 'pribadi')).pengeluaran).toBe(Number(trend?.x));
    await page.goto('/pribadi/laporan?basis=kalender');
    await expect(page.getByRole('navigation', { name: 'Pilih periode' })).toContainText(
      `${dateLabel(kalender.from)} – ${dateLabel(kalender.to)}`,
    );
  } finally {
    await adminQuery(
      `update app.households set payday_rule = $2
        where id = (select household_id from app.spaces where id = $1)`,
      [n.sid, asli],
    );
  }
  expect((await period(n)).from).toBe(kalender.from);
});

for (const url of ['/bersama/beranda', '/pribadi/laporan?basis=kalender']) {
  test(`JS muat dingin ${url} mode nyata ≤ 162 kB`, async ({ browser, ownerState }) => {
    await expectRouteBudget(browser, ownerState, url);
  });
}
