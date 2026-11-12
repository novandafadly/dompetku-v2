import { notFound } from 'next/navigation';
import { keptQuery, REAL_KEPT_PARAMS } from '@/features/shell/hrefs';
import { isPrototype } from '@/server/env';
import { rethrowOrNotFound } from '@/server/ledger/page-guard';
import { loadReview } from '@/server/ledger/review';
import { errorTag } from '@/server/ledger/transaksi';
import { ruangContext } from '../../_real/context';
import { ReviewFailed, ReviewReal } from '../../_real/review';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Review bulanan (S10-RV1): hanya mode nyata (prototipe 404). Gerbang di page (`ruangContext`),
 * lalu `loadReview` ruang ini saja. `?periode=YYYY-MM` rusak/di luar jangkauan = periode berjalan.
 * Galat loader = layar gagal muat; redirect/404 dari gerbang tetap dilempar.
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
  let data;
  try {
    data = await loadReview(ctx, { label: raw.periode });
  } catch (e) {
    rethrowOrNotFound(e);
    console.error('[review] gagal memuat', errorTag(e));
    return <ReviewFailed />;
  }
  return <ReviewReal ruang={ctx.ruang} query={query} data={data} />;
}
