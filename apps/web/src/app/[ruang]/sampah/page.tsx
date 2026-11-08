import { todayWIB } from '@dompetku/domain';
import { notFound, unstable_rethrow } from 'next/navigation';
import { buildHref, keptQuery, REAL_KEPT_PARAMS } from '@/features/shell/hrefs';
import { isPrototype } from '@/server/env';
import { isSpaceNotFoundError } from '@/server/ledger/errors';
import { loadSampah } from '@/server/ledger/sampah';
import { errorTag } from '@/server/ledger/transaksi';
import { ruangContext } from '../_real/context';
import { SampahFailed, SampahReal } from '../_real/sampah';
import { SampahPage } from './view';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Prototipe: entri batal dari store demo, tanpa auth/DB. Nyata: gerbang di page (`ruangContext` =
 * `requireDataUser()` → `resolveSpace`), lalu `loadSampah` ruang ini lewat `withUser`. Galat loader =
 * layar gagal muat (bukan galat rute); redirect/404 dari gerbang tetap dilempar. Halaman berdata:
 * dirender per request, `Cache-Control: no-store`.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ ruang: string }>;
  searchParams: SearchParams;
}) {
  if (isPrototype()) return <SampahPage />;
  const ctx = await ruangContext(params);
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') sp.set(k, v);
  const backHref = buildHref(ctx.ruang, 'transaksi', keptQuery(sp, REAL_KEPT_PARAMS));

  let data;
  try {
    data = await loadSampah(ctx);
  } catch (e) {
    unstable_rethrow(e);
    if (isSpaceNotFoundError(e)) notFound();
    console.error('[sampah] gagal memuat', errorTag(e));
    return <SampahFailed ruang={ctx.ruang} backHref={backHref} />;
  }
  return (
    <SampahReal
      ruang={ctx.ruang}
      today={todayWIB()}
      backHref={backHref}
      data={data}
      me={ctx.userId}
    />
  );
}
