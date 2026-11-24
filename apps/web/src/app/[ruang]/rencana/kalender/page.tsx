import { notFound } from 'next/navigation';
import { keptQuery, REAL_KEPT_PARAMS } from '@/features/shell/hrefs';
import { isPrototype } from '@/server/env';
import { loadKalender, parseKalenderDays } from '@/server/ledger/kalender';
import { rethrowOrNotFound } from '@/server/ledger/page-guard';
import { errorTag } from '@/server/ledger/transaksi';
import { ruangContext } from '../../_real/context';
import { KalenderFailed, KalenderReal } from '../../_real/kalender';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Kalender arus kas (S16-KL2): hanya mode nyata (prototipe 404). Gerbang di page (`ruangContext`),
 * lalu `loadKalender` ruang ini saja (B13). `?hari=30|60|90`, nilai lain = 30.
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
  const days = parseKalenderDays(raw.hari);
  let data;
  try {
    data = await loadKalender(ctx, days);
  } catch (e) {
    rethrowOrNotFound(e);
    console.error('[kalender] gagal memuat', errorTag(e));
    return <KalenderFailed />;
  }
  return <KalenderReal ruang={ctx.ruang} query={query} data={data} />;
}
