import 'server-only';
import { addMonths, type IsoDate } from '@dompetku/domain';
import type {
  AnalysisCategoryVM,
  AnalysisOverviewVM,
  AnalysisPeriodChoice,
  RunAnalysisResult,
} from '@/features/analisis/types';
import type { CategorySummaryVM } from '@/features/laporan/types';
import { categoriesTx, resolveViewed, trendTx } from '@/server/ledger/laporan';
import { periodLabel, safeToSpendTx } from '@/server/ledger/read';
import { withLedger } from '@/server/ledger/retry';
import type { LedgerCtx } from '@/server/ledger/write';
import { getConfiguredProviders } from './config';
import {
  LlmProviderError,
  type LlmAnalysisRaw,
  type LlmAnalysisRequest,
  type LlmProvider,
  type LlmProviderName,
} from './provider';
import { consumeAiQuotaTx, getAiQuotaTx } from './quota';

/**
 * Layanan server Analisis AI (S18, B13):
 * - Membaca ringkasan angka SQL periode berjalan atau periode sebelumnya untuk SATU ruang aktif
 *   (`ctx.spaceId`) dalam satu transaksi `withLedger`.
 * - Saat AI dijalankan: hanya mengirim angka agregat (pemasukan, pengeluaran, selisih, sisa aman,
 *   dan 6 kategori pengeluaran teratas) — TIDAK PERNAH deskripsi transaksi, dompet, kontak, atau
 *   ruang lain.
 * - Kuota harian (`analysis`: 5/hari/user WIB) dipotong atomik di DB hanya saat data ada dan
 *   minimal satu penyedia LLM aktif.
 */

export interface AnalyzeOptions {
  providers?: readonly LlmProvider[];
}

const DEFAULT_ANALYSIS_LIMIT = 5;

function categoryDisplayName(c: CategorySummaryVM): string {
  if (c.name !== null && c.name.trim() !== '') return c.name.trim();
  if (c.kind === 'fee') return 'Biaya transfer';
  return 'Tanpa kategori';
}

/**
 * Gabungkan kategori pengeluaran menjadi daftar teratas per akar kategori (maks 6).
 * Angka tetap murni dari SQL (`rootTotal`, `rootPct10`, `entryCount`).
 * Kategori induk dengan transaksi hanya di subkategori tetap dihitung (`rootTotal > 0`, `amount = 0`).
 */
export function selectTopExpenseCategories(
  rows: readonly CategorySummaryVM[],
): AnalysisCategoryVM[] {
  const rootCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.type !== 'expense' || r.kind !== 'category') continue;
    const rootId = r.rootCategoryId ?? r.categoryId;
    if (rootId === null) continue;
    rootCounts.set(rootId, (rootCounts.get(rootId) ?? 0) + r.entryCount);
  }

  const byKey = new Map<string, AnalysisCategoryVM>();
  for (const r of rows) {
    if (r.type !== 'expense') continue;
    const isChild =
      r.kind === 'category' && r.rootCategoryId !== null && r.rootCategoryId !== r.categoryId;
    if (isChild) continue;
    const effectiveAmount = r.kind === 'category' ? r.rootTotal : r.amount;
    if (effectiveAmount <= 0) continue;
    const key =
      r.kind === 'category'
        ? (r.categoryId ?? categoryDisplayName(r))
        : `${r.kind}:${categoryDisplayName(r)}`;
    if (byKey.has(key)) continue;
    const rootId = r.rootCategoryId ?? r.categoryId;
    byKey.set(key, {
      name: categoryDisplayName(r),
      amount: effectiveAmount,
      pct: Math.round((r.kind === 'category' ? r.rootPct10 : r.pct10) / 10),
      entryCount:
        r.kind === 'category' && rootId !== null
          ? (rootCounts.get(rootId) ?? r.entryCount)
          : r.entryCount,
    });
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);
}

export async function loadAnalysisOverview(
  ctx: LedgerCtx & { kind: 'personal' | 'shared' },
  periodChoice: AnalysisPeriodChoice = 'current',
  opts?: AnalyzeOptions,
): Promise<AnalysisOverviewVM> {
  const providers = opts?.providers ?? getConfiguredProviders();
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { current } = await resolveViewed(c, ctx, undefined, 'gajian');
    const viewed = periodChoice === 'previous' ? addMonths(current, -1) : current;
    const viewedMonth: IsoDate = `${viewed}-01`;

    const [prevRow, row] = await trendTx(c, ctx, viewedMonth, 2, 'gajian');
    if (!row || !prevRow) throw new Error('period_trend kosong');

    const categories = await categoriesTx(c, ctx, row.from, row.to);
    const topCategories = selectTopExpenseCategories(categories);

    const safe = periodChoice === 'current' ? await safeToSpendTx(c, ctx) : null;
    const quotas = await getAiQuotaTx(c, 'analysis');
    const q = quotas[0];

    const hasData = row.pemasukan > 0 || row.pengeluaran > 0;
    const hasPrevData = prevRow.pemasukan > 0 || prevRow.pengeluaran > 0;

    return {
      periodChoice,
      periodLabel: periodLabel(viewedMonth, row.from, row.to),
      from: row.from,
      to: row.to,
      labelMonth: viewedMonth,
      income: row.pemasukan,
      expense: row.pengeluaran,
      net: row.selisih,
      previousExpense: hasPrevData ? prevRow.pengeluaran : null,
      safeToSpend: safe === null ? null : safe.aman,
      daysLeft: safe === null ? row.daysLeft : safe.daysLeft,
      topCategories,
      hasData,
      aiConfigured: providers.length > 0,
      quota: {
        used: q?.used ?? 0,
        limit: q?.limit ?? DEFAULT_ANALYSIS_LIMIT,
        remaining: q?.remaining ?? DEFAULT_ANALYSIS_LIMIT,
        day: q?.day ?? row.to,
      },
    };
  });
}

async function callAnalysisChain(
  providers: readonly LlmProvider[],
  req: LlmAnalysisRequest,
): Promise<{ provider: LlmProviderName; raw: LlmAnalysisRaw } | null> {
  for (const provider of providers) {
    if (provider.analyzeSpending === undefined) continue;
    try {
      const raw = await provider.analyzeSpending(req);
      return { provider: provider.name, raw };
    } catch (e) {
      const tag =
        e instanceof LlmProviderError ? `${e.provider}:${e.code}` : `${provider.name}:err`;
      console.error('[ai analysis] failover', tag);
    }
  }
  return null;
}

export async function runAiAnalysis(
  ctx: LedgerCtx & { kind: 'personal' | 'shared' },
  periodChoice: AnalysisPeriodChoice = 'current',
  opts?: AnalyzeOptions,
): Promise<RunAnalysisResult> {
  const providers = (opts?.providers ?? getConfiguredProviders()).filter(
    (p) => p.analyzeSpending !== undefined,
  );
  const overview = await loadAnalysisOverview(ctx, periodChoice, { providers });

  if (!overview.hasData) {
    return { ok: false, code: 'no_data' };
  }
  if (providers.length === 0) {
    return { ok: false, code: 'not_configured' };
  }

  // Potong kuota harian 'analysis' (5/hari/user WIB) atomik di DB.
  const quota = await withLedger(ctx.pools, ctx.userId, ctx.spaceId, (c) =>
    consumeAiQuotaTx(c, 'analysis'),
  );
  const quotaInfo = {
    used: quota.used,
    limit: quota.limit,
    remaining: quota.remaining,
    exhausted: !quota.allowed,
  };
  if (!quota.allowed) {
    return { ok: false, code: 'quota_exceeded', quota: quotaInfo };
  }

  const outcome = await callAnalysisChain(providers, {
    spaceKind: ctx.kind,
    periodLabel: overview.periodLabel,
    income: overview.income,
    expense: overview.expense,
    net: overview.net,
    previousExpense: overview.previousExpense,
    safeToSpend: overview.safeToSpend,
    daysLeft: overview.daysLeft,
    topCategories: overview.topCategories.map((c) => ({
      name: c.name,
      amount: c.amount,
      pct: c.pct,
    })),
  });

  if (outcome === null) {
    return { ok: false, code: 'network', quota: quotaInfo };
  }

  return {
    ok: true,
    analysis: {
      ringkasan: outcome.raw.ringkasan,
      sorotan: outcome.raw.sorotan,
      saran: outcome.raw.saran,
      provider: outcome.provider,
    },
    quota: quotaInfo,
  };
}
