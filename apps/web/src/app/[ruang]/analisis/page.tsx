import { notFound } from 'next/navigation';
import { keptQuery, REAL_KEPT_PARAMS } from '@/features/shell/hrefs';
import { loadAnalysisOverview } from '@/server/ai/analyze';
import { isPrototype } from '@/server/env';
import { rethrowOrNotFound } from '@/server/ledger/page-guard';
import { errorTag } from '@/server/ledger/transaksi';
import { AnalisisClient, AnalisisFailed } from '../_real/analisis-client';
import { ruangContext } from '../_real/context';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Halaman Analisis AI (`/[ruang]/analisis`, S18): mode nyata saja (prototipe 404).
 * Gerbang `ruangContext` (`requireDataUser()` → `resolveSpace`), lalu `loadAnalysisOverview`
 * ruang aktif saja (B13). Dirender per request (`connection()` di `ruangContext`), no-store.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ ruang: string }>;
  searchParams: SearchParams;
}) {
  if (isPrototype()) notFound();
  const ctx = await ruangContext(params);
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') sp.set(k, v);
  const query = keptQuery(sp, REAL_KEPT_PARAMS);
  const periodChoice = raw.periode === 'lalu' ? 'previous' : 'current';

  let data;
  try {
    data = await loadAnalysisOverview(ctx, periodChoice);
  } catch (e) {
    rethrowOrNotFound(e);
    console.error('[analisis] gagal memuat', errorTag(e));
    return <AnalisisFailed ruang={ctx.ruang} query={query} />;
  }

  return <AnalisisClient key={data.periodChoice} ruang={ctx.ruang} query={query} data={data} />;
}
