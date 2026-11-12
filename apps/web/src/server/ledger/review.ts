import 'server-only';
import { addMonths, type IsoDate } from '@dompetku/domain';
import type {
  CategorySummaryVM,
  LaporanPeriodVM,
  LaporanSummaryVM,
} from '@/features/laporan/types';
import type { BudgetOverviewVM, BudgetTotalsVM } from '@/features/rencana/types';
import {
  categoriesTx,
  type LaporanParams,
  parseLaporanParams,
  periodOf,
  resolveViewed,
  summaryOf,
  trendTx,
} from './laporan';
import { budgetOverviewTx, budgetTotalsTx } from './rencana';
import { withLedger } from './retry';
import type { LedgerCtx } from './write';

/**
 * Loader Review bulanan `/[ruang]/rencana/review` (S10 Task 6, bingkai S10-RV1/RV2). Tidak punya
 * angka sendiri: satu `withLedger` memanggil fungsi yang sama dengan Laporan (`period_trend`,
 * `category_summary`) dan Rencana (`budget_overview`, total anggaran), atas rentang periode yang
 * sama, jadi "bulan lalu vs rencana" = angka Laporan secara konstruksi. Hanya dasar periode gajian
 * (anggaran berlabel periode gajian). Hanya ruang ini (`assert_member` di tiap fungsi; B13).
 */
export interface ReviewData {
  period: LaporanPeriodVM;
  summary: LaporanSummaryVM;
  /** Total kartu anggaran periode ini (induk saja, SQL). */
  totals: BudgetTotalsVM;
  /** Induk dan rincian `budget_overview` periode yang dilihat. */
  budgets: BudgetOverviewVM[];
  /** Induk yang punya pengeluaran tetapi tanpa anggaran (`root_total` dari SQL). */
  unbudgeted: CategorySummaryVM[];
  /**
   * Aksi `Siapkan {Bulan berikutnya}`: hanya untuk periode yang baru selesai atau berjalan dan
   * yang punya ≥ 1 anggaran. `count` = jumlah baris anggaran (induk + rincian), bukan uang.
   */
  copy: { toMonth: string; count: number } | null;
}

export async function loadReview(
  ctx: LedgerCtx,
  params: Pick<LaporanParams, 'label'> = {},
): Promise<ReviewData> {
  const { label } = parseLaporanParams({ label: params.label });
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { current, viewed } = await resolveViewed(c, ctx, label, 'gajian');
    const viewedMonth: IsoDate = `${viewed}-01`;
    const [prevRow, row] = await trendTx(c, ctx, viewedMonth, 2, 'gajian');
    if (!row || !prevRow) throw new Error('period_trend kosong');
    const categories = await categoriesTx(c, ctx, row.from, row.to);
    const budgets = await budgetOverviewTx(c, ctx, viewedMonth);
    const totals = await budgetTotalsTx(c, ctx, viewedMonth);
    const budgeted = new Set(budgets.filter((b) => b.budget !== null).map((b) => b.categoryId));
    const unbudgeted = categories.filter(
      (k) =>
        k.kind === 'category' &&
        k.type === 'expense' &&
        k.categoryId !== null &&
        k.categoryId === k.rootCategoryId &&
        k.rootTotal > 0 &&
        !budgeted.has(k.categoryId),
    );
    const count = budgeted.size;
    return {
      period: periodOf(row, viewed, current, 'gajian'),
      summary: summaryOf(row, prevRow),
      totals,
      budgets,
      unbudgeted,
      copy:
        count > 0 && viewed >= addMonths(current, -1)
          ? { toMonth: addMonths(viewed, 1), count }
          : null,
    };
  });
}
