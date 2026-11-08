import 'server-only';
import type pg from 'pg';
import { z } from 'zod';
import { addMonths, type IsoDate } from '@dompetku/domain';
import type {
  BudgetProgressVM,
  CategorySummaryVM,
  ExcludedVM,
  LaporanBasis,
  LaporanPeriodVM,
  LaporanSummaryVM,
  TrendRowVM,
} from '@/features/laporan/types';
import type { ContributionVM } from '@/features/bersama/types';
import { contributionsTx, rosterTx } from './bersama';
import { periodLabel } from './read';
import { withLedger } from './retry';
import type { LedgerCtx } from './write';

/**
 * Loader Laporan `/[ruang]/laporan` (S9 Task 9/13, bingkai S9-LP*). Satu `withLedger`, bacaan
 * berurutan (pola `read.ts`): `api.pay_period` (periode berjalan), `api.period_trend` (periode
 * yang dilihat + pembanding, dan tren 6 periode sampai periode berjalan), `api.category_summary`,
 * `api.excluded_summary`, `api.budget_progress` (basis gajian saja), `api.member_contributions`
 * (Bersama ≥ 2 anggota, K10). Semua angka uang dari SQL (`report_lines` + `report_class`, satu
 * sumber dengan Beranda); loader hanya memilih baris dan memformat label. Hanya ruang ini
 * (`p_space_id = ctx.spaceId`, `assert_member` di setiap fungsi): Laporan Bersama tidak memuat data
 * Pribadi (B13). Tanggal dan "periode berjalan" dari `app.today()`, bukan jam Node.
 *
 * Parameter URL (`?periode=YYYY-MM&basis=gajian|kalender`) divalidasi Zod; apa pun yang tidak sah,
 * sebelum `2020-01`, atau sesudah periode berjalan = periode berjalan (bukan 404/500). Basis tidak
 * sah = `gajian`.
 */

/** Data halaman Laporan (dirangkai di sini: menggabungkan VM Laporan dan Kontribusi Bersama). */
export interface LaporanData {
  period: LaporanPeriodVM;
  summary: LaporanSummaryVM;
  classes: ExcludedVM[];
  categories: CategorySummaryVM[];
  /** `null` di basis kalender (anggaran milik periode gajian). */
  budgets: BudgetProgressVM[] | null;
  /** 6 periode sampai periode berjalan, baris awal yang seluruhnya nol dibuang. */
  trend: TrendRowVM[];
  /** Bersama ≥ 2 anggota, rentang periode yang dilihat (K10); selain itu `null`. */
  contributions: ContributionVM | null;
}

/** Batas paling awal pemilih periode (‹ nonaktif sesudahnya). */
export const LAPORAN_EARLIEST = '2020-01';
const TREND_COUNT = 6;

const monthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const basisParam = z.enum(['gajian', 'kalender']);

export interface LaporanParams {
  label?: string | string[] | undefined;
  basis?: string | string[] | undefined;
}

/** Parameter URL → nilai sah atau `undefined` (larik/kosong/rusak = tidak ada). */
export function parseLaporanParams(p: LaporanParams): {
  label: string | undefined;
  basis: LaporanBasis;
} {
  const label = monthParam.safeParse(p.label);
  const basis = basisParam.safeParse(p.basis);
  return {
    label: label.success && label.data >= LAPORAN_EARLIEST ? label.data : undefined,
    basis: basis.success ? basis.data : 'gajian',
  };
}

interface TrendRow {
  label_month: string;
  starts_on: string;
  ends_on: string;
  pemasukan: number;
  pengeluaran: number;
  selisih: number;
  complete: boolean;
  is_current: boolean;
  days_left: number | null;
  delta_pengeluaran: number | null;
  holidays_known: boolean;
}

function toTrend(r: TrendRow): TrendRowVM {
  return {
    labelMonth: r.label_month,
    from: r.starts_on,
    to: r.ends_on,
    pemasukan: r.pemasukan,
    pengeluaran: r.pengeluaran,
    selisih: r.selisih,
    complete: r.complete,
    isCurrent: r.is_current,
    daysLeft: r.days_left,
    deltaPengeluaran: r.delta_pengeluaran,
    holidaysKnown: r.holidays_known,
  };
}

async function trendTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  labelMonth: IsoDate,
  count: number,
  basis: LaporanBasis,
): Promise<TrendRowVM[]> {
  const { rows } = await c.query<TrendRow>(
    `select t.label_month, t.starts_on, t.ends_on, t.pemasukan, t.pengeluaran, t.selisih,
            t.complete, t.is_current, t.days_left, t.delta_pengeluaran, t.holidays_known
       from api.period_trend(p_space_id => $1, p_label_month => $2::date, p_count => $3::int,
                             p_basis => $4) t
      order by t.label_month`,
    [ctx.spaceId, labelMonth, count, basis],
  );
  return rows.map(toTrend);
}

const categoryRow = z.object({
  kind: z.enum(['category', 'uncategorized', 'fee']),
  root_category_id: z.guid().nullable(),
  category_id: z.guid().nullable(),
  type: z.enum(['income', 'expense']),
  amount: z.number().int(),
  entry_count: z.number().int(),
  type_total: z.number().int(),
  pct10: z.number().int(),
  root_total: z.number().int(),
  root_pct10: z.number().int(),
  pct10_in_root: z.number().int().nullable(),
  name: z.string().nullable(),
  icon: z.string().nullable(),
  archived: z.boolean().nullable(),
});

async function categoriesTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  from: IsoDate,
  to: IsoDate,
): Promise<CategorySummaryVM[]> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select k.kind, k.root_category_id, k.category_id, k.type::text as type, k.amount,
            k.entry_count, k.type_total, k.pct10, k.root_total, k.root_pct10, k.pct10_in_root,
            k.name, k.icon, k.archived
       from api.category_summary(p_space_id => $1, p_from => $2::date, p_to => $3::date)
            with ordinality as k (kind, root_category_id, category_id, type, amount, entry_count,
                                  type_total, pct10, root_total, root_pct10, pct10_in_root, name,
                                  icon, archived, n)
      order by k.n`,
    [ctx.spaceId, from, to],
  );
  return rows.map((raw) => {
    const r = categoryRow.parse(raw);
    return {
      kind: r.kind,
      rootCategoryId: r.root_category_id,
      categoryId: r.category_id,
      type: r.type,
      amount: r.amount,
      entryCount: r.entry_count,
      typeTotal: r.type_total,
      pct10: r.pct10,
      rootTotal: r.root_total,
      rootPct10: r.root_pct10,
      pct10InRoot: r.pct10_in_root,
      name: r.name,
      icon: r.icon,
      archived: r.archived,
    };
  });
}

const excludedRow = z.object({
  report_class: z.string().regex(/^x_[a-z_]+$/),
  direction: z.enum(['in', 'out']),
  amount: z.number().int(),
  entry_count: z.number().int(),
});

async function excludedTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  from: IsoDate,
  to: IsoDate,
): Promise<ExcludedVM[]> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select x.report_class, x.direction, x.amount, x.entry_count
       from api.excluded_summary(p_space_id => $1, p_from => $2::date, p_to => $3::date)
            with ordinality as x (report_class, direction, amount, entry_count, n)
      order by x.n`,
    [ctx.spaceId, from, to],
  );
  return rows.map((raw) => {
    const r = excludedRow.parse(raw);
    return {
      reportClass: r.report_class,
      direction: r.direction,
      amount: r.amount,
      entryCount: r.entry_count,
    };
  });
}

async function budgetProgressTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  labelMonth: IsoDate,
): Promise<BudgetProgressVM[]> {
  const { rows } = await c.query<{
    category_id: string;
    amount: number;
    wajib: boolean;
    spent: number;
    pct: number;
    remaining: number;
  }>(
    `select b.category_id, b.amount, b.wajib, b.spent, b.pct, b.remaining
       from api.budget_progress(p_space_id => $1, p_month => $2::date) b
      order by b.category_id`,
    [ctx.spaceId, labelMonth],
  );
  return rows.map((r) => ({
    categoryId: r.category_id,
    amount: r.amount,
    wajib: r.wajib,
    spent: r.spent,
    pct: r.pct,
    remaining: r.remaining,
  }));
}

/** Buang baris awal tren yang Pemasukan dan Pengeluarannya nol (data belum ada). */
function trimLeadingEmpty(rows: TrendRowVM[]): TrendRowVM[] {
  const i = rows.findIndex((r) => r.pemasukan !== 0 || r.pengeluaran !== 0);
  return i === -1 ? rows.slice(-1) : rows.slice(i);
}

export async function loadLaporan(
  ctx: LedgerCtx & { kind: 'personal' | 'shared' },
  params: LaporanParams = {},
): Promise<LaporanData> {
  const { label, basis } = parseLaporanParams(params);
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<{ label_month: string; today: string }>(
      `select p.label_month, app.today() as today from api.pay_period(p_space_id => $1) p`,
      [ctx.spaceId],
    );
    const now = rows[0];
    if (!now) throw new Error('pay_period kosong');
    const current = basis === 'gajian' ? now.label_month.slice(0, 7) : now.today.slice(0, 7);
    const viewed = label !== undefined && label <= current ? label : current;
    const viewedMonth: IsoDate = `${viewed}-01`;

    // Dua baris berakhir di periode yang dilihat: [sebelumnya, dilihat] (urut lama ke baru).
    const [prevRow, row] = await trendTx(c, ctx, viewedMonth, 2, basis);
    if (!row || !prevRow) throw new Error('period_trend kosong');

    const categories = await categoriesTx(c, ctx, row.from, row.to);
    const classes = await excludedTx(c, ctx, row.from, row.to);
    const budgets = basis === 'gajian' ? await budgetProgressTx(c, ctx, viewedMonth) : null;
    const trend = trimLeadingEmpty(await trendTx(c, ctx, `${current}-01`, TREND_COUNT, basis));

    let contributions = null;
    if (ctx.kind === 'shared') {
      const roster = await rosterTx(c, ctx);
      if (roster.length >= 2) {
        contributions = await contributionsTx(
          c,
          ctx,
          { from: row.from, to: row.to, labelMonth: viewedMonth },
          roster,
        );
      }
    }

    const prev = addMonths(viewed, -1);
    return {
      period: {
        label: periodLabel(viewedMonth, row.from, row.to),
        from: row.from,
        to: row.to,
        labelMonth: viewedMonth,
        holidaysKnown: row.holidaysKnown,
        basis,
        isCurrent: row.isCurrent,
        complete: row.complete,
        daysLeft: row.daysLeft,
        prev: prev >= LAPORAN_EARLIEST ? prev : null,
        next: viewed < current ? addMonths(viewed, 1) : null,
      },
      summary: {
        pemasukan: row.pemasukan,
        pengeluaran: row.pengeluaran,
        selisih: row.selisih,
        deltaPengeluaran: row.deltaPengeluaran,
        previous: { labelMonth: prevRow.labelMonth, pengeluaran: prevRow.pengeluaran },
      },
      classes,
      categories,
      budgets,
      trend,
      contributions,
    };
  });
}
