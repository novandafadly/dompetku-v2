import 'server-only';
import type pg from 'pg';
import { z } from 'zod';
import { addMonths, type IsoDate, type Rupiah } from '@dompetku/domain';
import type { AccountVM, CategoryVM } from '@/features/ledger/types';
import type {
  BillDueVM,
  BillListVM,
  BudgetOverviewVM,
  BudgetTotalsVM,
  PreviousBudgetsVM,
  RencanaData,
} from '@/features/rencana/types';
import { listAccountsTx, listCategoriesTx, payPeriodTx, type RuangShellData } from './read';
import { withLedger } from './retry';
import { callApi, NotInSpaceError, type LedgerCtx } from './write';

/**
 * Rencana (S9): bacaan anggaran dan tagihan + wrapper tulis `api.*` anggaran/tagihan (pola
 * `read.ts` dan `write.ts`):
 * - bacaan `fooTx(c, ctx, …)` di transaksi pemanggil; `loadRencana` merangkainya BERURUTAN di satu
 *   `withLedger` (satu koneksi; dompet + kategori dari layout bila diberikan, ditunggu di luar
 *   transaksi seperti `loadBeranda`);
 * - setiap kueri dibatasi `space_id = ctx.spaceId` (fungsi `api.*` ber-`p_space_id` memanggil
 *   `assert_member`; join kategori/dompet ikut membawa `space_id` yang sama);
 * - fungsi tagihan yang hanya menerima id (`update_bill`, `archive_bill`, bayar, lewati) didahului
 *   cek ruang: tagihan/kemunculan wajib di `ctx.spaceId` (`NotInSpaceError` = DK404 → `not_found`),
 *   sehingga tagihan Pribadi tidak bisa disentuh dari rute Bersama walau user anggota keduanya;
 * - bulan anggaran = label periode gajian `YYYY-MM` (K1) yang dilihat pengguna, dikirim apa adanya
 *   (DB menolak bulan bukan tanggal 1); "hari ini" selalu `app.today()` di SQL, bukan jam Node;
 * - Zod sebelum pool; hasil DB divalidasi Zod di dalam transaksi. Tidak ada log di sini.
 */

// ===== Skema input (diekspor untuk server action: satu sumber batas) =====
const id = z.uuid();
/**
 * Label periode `YYYY-MM` dan tanggal dalam rentang wajar (2000–2099): tahun ekstrem ditolak Zod
 * sebelum DB (bukan galat non-DK400 dari `::date`, catatan review Task 8).
 */
const month = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
const amount = z
  .number()
  .int()
  .positive()
  .max(10 ** 13);
const isoDate = z.iso.date().regex(/^20\d{2}-/);
const billName = z.string().trim().min(1).max(60);
const dayOfMonth = z.number().int().min(1).max(31);

export const setBudgetSchema = z.object({
  categoryId: id,
  month,
  amount,
  wajib: z.boolean(),
});
export const deleteBudgetSchema = z.object({ categoryId: id, month });
/** K13: salin dari periode sebelum `toMonth` (label) ke `toMonth`. */
export const copyBudgetsSchema = z.object({ toMonth: month });

export const createBillSchema = z
  .object({
    clientId: id,
    name: billName,
    amount,
    categoryId: id,
    dayOfMonth,
    startsOn: isoDate,
    endsOn: isoDate.nullable().optional(),
    accountId: id.nullable().optional(),
  })
  .refine((v) => v.endsOn == null || v.endsOn >= v.startsOn, { path: ['endsOn'] });

/** Ganti penuh (`api.update_bill`); `startsOn` tidak bisa diubah. */
export const updateBillSchema = z.object({
  billId: id,
  name: billName,
  amount,
  categoryId: id,
  dayOfMonth,
  endsOn: isoDate.nullable(),
  accountId: id.nullable(),
});
export const billIdSchema = z.object({ billId: id });

export const payBillSchema = z.object({
  clientId: id,
  occurrenceId: id,
  accountId: id.optional(),
  occurredOn: isoDate.optional(),
  /** Nominal aktual (K12); kosong = nominal kemunculan. */
  amount: amount.optional(),
  allowNegative: z.boolean().optional(),
});
export const occurrenceIdSchema = z.object({ occurrenceId: id });

// ===== Skema hasil =====
const budgetRow = z.object({
  category_id: z.guid(),
  name: z.string(),
  icon: z.string(),
  budget: z.number().int().nullable(),
  wajib: z.boolean(),
  spent: z.number().int(),
  pct: z.number().int().nullable(),
  remaining: z.number().int().nullable(),
  archived: z.boolean(),
});

const copyResult = z.object({
  copied: z.number().int().min(0),
  skipped_existing: z.number().int().min(0),
  skipped_conflict: z.number().int().min(0),
  skipped_archived: z.number().int().min(0),
});
const billResult = z.object({ bill_id: z.uuid() });
const payResult = z.object({
  entry_id: z.uuid(),
  occurrence_id: z.uuid(),
  version: z.number().int(),
  replayed: z.boolean(),
  warnings: z.array(z.string()),
});
const skipResult = z.object({ occurrence_id: z.uuid(), skipped: z.boolean() });

// ===== Pembantu =====
const first = (m: string): IsoDate => `${m}-01`;

type RencanaTable = 'bills' | 'bill_occurrences';

/** SQL tetap per tabel (tanpa interpolasi nama dari input). */
const IN_SPACE_SQL: Record<RencanaTable, string> = {
  bills: 'select count(*)::int as n from app.bills where id = $1 and space_id = $2',
  bill_occurrences:
    'select count(*)::int as n from app.bill_occurrences where id = $1 and space_id = $2',
};

async function assertRowInSpace(
  c: pg.PoolClient,
  table: RencanaTable,
  rowId: string,
  spaceId: string,
): Promise<void> {
  const { rows } = await c.query<{ n: number }>(IN_SPACE_SQL[table], [rowId, spaceId]);
  if (rows[0]?.n !== 1) throw new NotInSpaceError();
}

// ===== Baca =====
/**
 * `api.budget_overview` untuk label `labelMonth` (tanggal 1): induk pengeluaran + anggaran. Baris
 * rincian (`parent_id` terisi, 0126) disaring dulu; Task 4 S10 membawanya ke VM.
 */
export async function budgetOverviewTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  labelMonth: IsoDate,
): Promise<BudgetOverviewVM[]> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select b.category_id, b.name, b.icon, b.budget, b.wajib, b.spent, b.pct, b.remaining,
            b.archived
       from api.budget_overview(p_space_id => $1, p_month => $2::date) with ordinality
            as b (category_id, name, icon, budget, wajib, spent, pct, remaining, archived,
                  parent_id, sub_allocated, max_amount, n)
      where b.parent_id is null
      order by b.n`,
    [ctx.spaceId, labelMonth],
  );
  return rows.map((raw) => {
    const r = budgetRow.parse(raw);
    return {
      categoryId: r.category_id,
      name: r.name,
      icon: r.icon,
      budget: r.budget,
      wajib: r.wajib,
      spent: r.spent,
      pct: r.pct,
      remaining: r.remaining,
      archived: r.archived,
    };
  });
}

const totalsRow = z.object({
  total_budget: z.number().int(),
  total_spent: z.number().int(),
  total_remaining: z.number().int(),
  total_pct: z.number().int(),
});

/**
 * Total kartu Anggaran, dijumlah di SQL (BSD §1.1) dari baris `api.budget_overview` yang sama:
 * hanya kategori beranggaran (wajib dan terarsip yang masih beranggaran ikut); realisasi = kolom
 * `spent` per baris (wajib: tanpa bayar tagihan periode lain). `pct` = floor(Σ spent × 100 / Σ
 * budget), 0 bila tanpa anggaran.
 */
export async function budgetTotalsTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  labelMonth: IsoDate,
): Promise<BudgetTotalsVM> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select coalesce(sum(b.budget), 0)::bigint as total_budget,
            coalesce(sum(b.spent), 0)::bigint as total_spent,
            (coalesce(sum(b.budget), 0) - coalesce(sum(b.spent), 0))::bigint as total_remaining,
            case when coalesce(sum(b.budget), 0) > 0
                 then least(floor(sum(b.spent) * 100.0 / sum(b.budget)), 2147483647)::int
                 else 0 end as total_pct
       from api.budget_overview(p_space_id => $1, p_month => $2::date) b
      where b.budget is not null and b.parent_id is null`,
    [ctx.spaceId, labelMonth],
  );
  const r = totalsRow.parse(rows[0]);
  return {
    budget: r.total_budget,
    spent: r.total_spent,
    remaining: r.total_remaining,
    pct: r.total_pct,
  };
}

interface BillListRow {
  bill_id: string;
  name: string;
  amount: number;
  category_id: string;
  category_name: string;
  root_category_id: string;
  account_id: string | null;
  account_name: string | null;
  day_of_month: number;
  starts_on: string;
  ends_on: string | null;
  archived: boolean;
  next_due_on: string | null;
  next_occurrence_id: string | null;
}

/** `api.bill_list` + nama kategori dan dompet ruang yang sama (urutan fungsi). */
export async function billListTx(c: pg.PoolClient, ctx: LedgerCtx): Promise<BillListVM[]> {
  const { rows } = await c.query<BillListRow>(
    `select b.bill_id, b.name, b.amount, b.category_id, cat.name as category_name,
            coalesce(cat.parent_id, cat.id) as root_category_id, b.account_id,
            a.name as account_name, b.day_of_month, b.starts_on, b.ends_on, b.archived,
            b.next_due_on, b.next_occurrence_id
       from api.bill_list(p_space_id => $1) with ordinality
            as b (bill_id, name, amount, category_id, account_id, day_of_month, starts_on,
                  ends_on, archived, next_due_on, next_occurrence_id, n)
       join app.categories cat on cat.space_id = $1 and cat.id = b.category_id
       left join app.accounts a on a.space_id = $1 and a.id = b.account_id
      order by b.n`,
    [ctx.spaceId],
  );
  return rows.map((r) => ({
    billId: r.bill_id,
    name: r.name,
    amount: r.amount,
    categoryId: r.category_id,
    categoryName: r.category_name,
    rootCategoryId: r.root_category_id,
    accountId: r.account_id,
    accountName: r.account_name,
    dayOfMonth: r.day_of_month,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    archived: r.archived,
    nextDueOn: r.next_due_on,
    nextOccurrenceId: r.next_occurrence_id,
  }));
}

interface BillDueRow {
  occurrence_id: string;
  bill_id: string;
  name: string;
  amount: number;
  due_on: string;
  days_until: number;
  overdue: boolean;
  posted: boolean;
  skipped: boolean;
  entry_id: string | null;
  paid_on: string | null;
}

function toBillDue(r: BillDueRow): BillDueVM {
  return {
    occurrenceId: r.occurrence_id,
    billId: r.bill_id,
    name: r.name,
    amount: r.amount,
    dueOn: r.due_on,
    daysUntil: r.days_until,
    overdue: r.overdue,
    posted: r.posted,
    skipped: r.skipped,
    entryId: r.entry_id,
    paidOn: r.paid_on,
  };
}

/**
 * `api.bills_due`: `withinDays` kosong = sampai akhir periode berjalan (termasuk lunas/dilewati di
 * periode ini); `withinDays` = n → hanya yang terbuka (belum dibayar, belum dilewati) dengan jatuh
 * tempo ≤ `app.today() + n`, termasuk lewat (Beranda `Tagihan 7 hari`, T8 m0a).
 */
export async function billsDueTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  opts: { withinDays?: number } = {},
): Promise<BillDueVM[]> {
  const within =
    opts.withinDays === undefined ? null : z.number().int().min(0).max(62).parse(opts.withinDays);
  const { rows } = await c.query<BillDueRow>(
    `select d.occurrence_id, d.bill_id, d.name, d.amount, d.due_on, d.days_until, d.overdue,
            d.posted, d.skipped, d.entry_id, e.occurred_on as paid_on
       from api.bills_due(p_space_id => $1,
                          p_through => case when $2::int is null then null
                                            else app.today() + $2::int end) with ordinality
            as d (occurrence_id, bill_id, name, amount, due_on, days_until, overdue, posted,
                  skipped, entry_id, n)
       left join app.entries e on e.space_id = $1 and e.id = d.entry_id and d.posted
      where $2::int is null or (not d.posted and not d.skipped)
      order by d.n`,
    [ctx.spaceId, within],
  );
  return rows.map(toBillDue);
}

/**
 * Kemunculan SESUDAH akhir periode berjalan (kelompok `Berikutnya`): `api.bills_due` sampai
 * `ends_on + 62` hari (materialisasi paling jauh akhir periode berikutnya), hanya yang jatuh
 * tempo setelah `ends_on`. Tanggal dihitung SQL dari `api.pay_period`, bukan jam Node.
 */
export async function billsUpcomingTx(c: pg.PoolClient, ctx: LedgerCtx): Promise<BillDueVM[]> {
  const { rows } = await c.query<BillDueRow>(
    `with p as (select ends_on from api.pay_period(p_space_id => $1))
     select d.occurrence_id, d.bill_id, d.name, d.amount, d.due_on, d.days_until, d.overdue,
            d.posted, d.skipped, d.entry_id, e.occurred_on as paid_on
       from p,
            lateral api.bills_due(p_space_id => $1, p_through => p.ends_on + 62) with ordinality
            as d (occurrence_id, bill_id, name, amount, due_on, days_until, overdue, posted,
                  skipped, entry_id, n)
       left join app.entries e on e.space_id = $1 and e.id = d.entry_id and d.posted
      where d.due_on > p.ends_on
      order by d.n`,
    [ctx.spaceId],
  );
  return rows.map(toBillDue);
}

/** Hari ini WIB (`app.today()`), sebagai YYYY-MM-DD. */
async function todayTx(c: pg.PoolClient): Promise<IsoDate> {
  const { rows } = await c.query<{ today: string }>(
    "select to_char(app.today(), 'YYYY-MM-DD') as today",
  );
  const r = rows[0];
  if (!r) throw new Error('today kosong');
  return r.today;
}

/** Ringkasan anggaran periode lalu dari baris `budget_overview` (hanya yang dianggarkan). */
function previousOf(labelMonth: IsoDate, rows: BudgetOverviewVM[]): PreviousBudgetsVM {
  const budgeted = rows.filter((r) => r.budget !== null);
  const amounts: Record<string, Rupiah> = {};
  for (const r of budgeted) if (r.budget !== null) amounts[r.categoryId] = r.budget;
  return {
    labelMonth,
    budgetCount: budgeted.length,
    wajibCount: budgeted.filter((r) => r.wajib).length,
    amounts,
  };
}

/**
 * Halaman Rencana nyata (`/[ruang]/rencana`): periode berjalan, anggaran periode ini dan periode
 * lalu (K13), tagihan, kemunculan periode ini, dompet dan kategori ruang ini. Satu `withLedger`;
 * `shell` = dompet + kategori yang sudah dimuat layout untuk request yang sama (ditunggu di luar
 * transaksi: koneksi tidak pernah ditahan sambil menunggu koneksi lain).
 */
export async function loadRencana(
  ctx: LedgerCtx,
  opts: { shell?: Promise<RuangShellData> } = {},
): Promise<RencanaData> {
  const given = opts.shell;
  const [read, shell] = await Promise.all([
    withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
      const period = await payPeriodTx(c, ctx);
      const budgets = await budgetOverviewTx(c, ctx, period.labelMonth);
      const totals = await budgetTotalsTx(c, ctx, period.labelMonth);
      const prevMonth = first(addMonths(period.labelMonth.slice(0, 7), -1));
      const previous = previousOf(prevMonth, await budgetOverviewTx(c, ctx, prevMonth));
      const bills = await billListTx(c, ctx);
      const due = await billsDueTx(c, ctx);
      const upcoming = await billsUpcomingTx(c, ctx);
      const today = await todayTx(c);
      let own: { accounts: AccountVM[]; categories: CategoryVM[] } | null = null;
      if (given === undefined) {
        own = {
          accounts: await listAccountsTx(c, ctx),
          categories: await listCategoriesTx(c, ctx),
        };
      }
      return { period, budgets, totals, previous, bills, due, upcoming, today, own };
    }),
    given ?? null,
  ]);
  const { own, ...rest } = read;
  const s = shell ?? own;
  if (!s) throw new Error('dompet dan kategori Rencana tidak dimuat');
  return { ...rest, accounts: s.accounts, categories: s.categories };
}

// ===== Tulis: anggaran =====
export interface SetBudgetInput {
  categoryId: string;
  /** Label periode `YYYY-MM`. */
  month: string;
  amount: Rupiah;
  wajib: boolean;
}

/** `api.set_budget` (upsert, idempoten alami). */
export async function setBudget(ctx: LedgerCtx, i: SetBudgetInput): Promise<void> {
  const v = setBudgetSchema.parse(i);
  await callApi(
    ctx,
    null,
    `select true as r
       from api.set_budget(p_space_id => $1, p_category_id => $2, p_month => $3::date,
                           p_amount => $4::bigint, p_wajib => $5)`,
    [ctx.spaceId, v.categoryId, first(v.month), v.amount, v.wajib],
    z.boolean(),
  );
}

/** `api.delete_budget` (tanpa baris = no-op). */
export async function deleteBudget(
  ctx: LedgerCtx,
  i: { categoryId: string; month: string },
): Promise<void> {
  const v = deleteBudgetSchema.parse(i);
  await callApi(
    ctx,
    null,
    `select true as r
       from api.delete_budget(p_space_id => $1, p_category_id => $2, p_month => $3::date)`,
    [ctx.spaceId, v.categoryId, first(v.month)],
    z.boolean(),
  );
}

export interface CopyBudgetsValue {
  copied: number;
  skippedExisting: number;
  skippedConflict: number;
  skippedArchived: number;
}

/** `api.copy_budgets` (K13): periode label sebelum `toMonth` → `toMonth`; tidak menimpa. */
export async function copyBudgets(
  ctx: LedgerCtx,
  i: { toMonth: string },
): Promise<CopyBudgetsValue> {
  const v = copyBudgetsSchema.parse(i);
  const r = await callApi(
    ctx,
    null,
    `select to_jsonb(k) as r
       from api.copy_budgets(p_space_id => $1, p_from_month => $2::date, p_to_month => $3::date) k`,
    [ctx.spaceId, first(addMonths(v.toMonth, -1)), first(v.toMonth)],
    copyResult,
  );
  return {
    copied: r.copied,
    skippedExisting: r.skipped_existing,
    skippedConflict: r.skipped_conflict,
    skippedArchived: r.skipped_archived,
  };
}

// ===== Tulis: tagihan =====
export interface CreateBillInput {
  clientId: string;
  name: string;
  amount: Rupiah;
  categoryId: string;
  dayOfMonth: number;
  startsOn: IsoDate;
  endsOn?: IsoDate | null | undefined;
  accountId?: string | null | undefined;
}

/** `api.create_bill` (idempoten lewat `clientId`; kemunculan dibuat langsung, K3). */
export async function createBill(ctx: LedgerCtx, i: CreateBillInput): Promise<{ billId: string }> {
  const v = createBillSchema.parse(i);
  const r = await callApi(
    ctx,
    null,
    `select api.create_bill(
       p_client_id => $1, p_space_id => $2, p_name => $3, p_amount => $4::bigint,
       p_category_id => $5, p_day_of_month => $6::smallint, p_starts_on => $7::date,
       p_ends_on => $8::date, p_account_id => $9) as r`,
    [
      v.clientId,
      ctx.spaceId,
      v.name,
      v.amount,
      v.categoryId,
      v.dayOfMonth,
      v.startsOn,
      v.endsOn ?? null,
      v.accountId ?? null,
    ],
    billResult,
  );
  return { billId: r.bill_id };
}

export interface UpdateBillInput {
  billId: string;
  name: string;
  amount: Rupiah;
  categoryId: string;
  dayOfMonth: number;
  endsOn: IsoDate | null;
  accountId: string | null;
}

/** `api.update_bill`: hanya kemunculan terbuka mulai hari ini yang berubah. */
export async function updateBill(ctx: LedgerCtx, i: UpdateBillInput): Promise<{ billId: string }> {
  const v = updateBillSchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertRowInSpace(c, 'bills', v.billId, ctx.spaceId),
    `select api.update_bill(
       p_bill_id => $1, p_name => $2, p_amount => $3::bigint, p_category_id => $4,
       p_day_of_month => $5::smallint, p_account_id => $6, p_ends_on => $7::date) as r`,
    [v.billId, v.name, v.amount, v.categoryId, v.dayOfMonth, v.accountId, v.endsOn],
    billResult,
  );
  return { billId: r.bill_id };
}

/** `api.archive_bill` (idempoten alami); kemunculan terbuka ikut dilewati. */
export async function archiveBill(ctx: LedgerCtx, billId: string): Promise<{ billId: string }> {
  const v = billIdSchema.parse({ billId });
  const r = await callApi(
    ctx,
    (c) => assertRowInSpace(c, 'bills', v.billId, ctx.spaceId),
    'select api.archive_bill(p_bill_id => $1) as r',
    [v.billId],
    billResult,
  );
  return { billId: r.bill_id };
}

export interface PayBillInput {
  clientId: string;
  occurrenceId: string;
  accountId?: string | undefined;
  occurredOn?: IsoDate | undefined;
  amount?: Rupiah | undefined;
  allowNegative?: boolean | undefined;
}

/**
 * `api.post_bill_occurrence`: bayar = pengeluaran berkategori tagihan (idempoten lewat
 * `clientId`; klik ganda = satu entri). Kemunculan wajib di ruang konteks; dompet dicek DB di
 * ruang kemunculan (ruang yang sama).
 */
export async function payBill(
  ctx: LedgerCtx,
  i: PayBillInput,
): Promise<{
  entryId: string;
  occurrenceId: string;
  version: number;
  replayed: boolean;
  warnings: string[];
}> {
  const v = payBillSchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertRowInSpace(c, 'bill_occurrences', v.occurrenceId, ctx.spaceId),
    `select api.post_bill_occurrence(
       p_client_id => $1, p_occurrence_id => $2, p_account_id => $3, p_occurred_on => $4::date,
       p_allow_negative => $5, p_amount => $6::bigint) as r`,
    [
      v.clientId,
      v.occurrenceId,
      v.accountId ?? null,
      v.occurredOn ?? null,
      v.allowNegative ?? false,
      v.amount ?? null,
    ],
    payResult,
  );
  return {
    entryId: r.entry_id,
    occurrenceId: r.occurrence_id,
    version: r.version,
    replayed: r.replayed,
    warnings: r.warnings,
  };
}

/** `api.skip_bill_occurrence` / `api.unskip_bill_occurrence` (K4, idempoten alami). */
export async function setOccurrenceSkipped(
  ctx: LedgerCtx,
  occurrenceId: string,
  skipped: boolean,
): Promise<{ skipped: boolean }> {
  const v = occurrenceIdSchema.parse({ occurrenceId });
  const r = await callApi(
    ctx,
    (c) => assertRowInSpace(c, 'bill_occurrences', v.occurrenceId, ctx.spaceId),
    skipped
      ? 'select api.skip_bill_occurrence(p_occurrence_id => $1) as r'
      : 'select api.unskip_bill_occurrence(p_occurrence_id => $1) as r',
    [v.occurrenceId],
    skipResult,
  );
  return { skipped: r.skipped };
}
