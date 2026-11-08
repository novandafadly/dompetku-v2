import { notFound, unstable_rethrow } from 'next/navigation';
import { laporanHref } from '@/features/laporan/href';
import { keptQuery, REAL_KEPT_PARAMS } from '@/features/shell/hrefs';
import { isPrototype } from '@/server/env';
import { isSpaceNotFoundError } from '@/server/ledger/errors';
import { loadLaporan, parseLaporanParams } from '@/server/ledger/laporan';
import { errorTag } from '@/server/ledger/transaksi';
import { ruangContext } from '../_real/context';
import { LaporanFailed, LaporanReal } from '../_real/laporan';
import { LaporanPage } from './view';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Prototipe: keadaan jujur tanpa data demo. Nyata: gerbang di page (`ruangContext` =
 * `requireDataUser()` → `resolveSpace`), lalu `loadLaporan` ruang ini saja lewat `withLedger`.
 * `?periode=YYYY-MM&basis=gajian|kalender` divalidasi di loader: rusak, di luar jangkauan, atau
 * ganda = periode berjalan (tidak pernah 404/500). Galat loader = layar gagal muat; redirect/404
 * dari gerbang tetap dilempar. Halaman berdata: dirender per request, `Cache-Control: no-store`.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ ruang: string }>;
  searchParams: SearchParams;
}) {
  if (isPrototype()) return <LaporanPage />;
  const ctx = await ruangContext(params);
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') sp.set(k, v);
  const query = keptQuery(sp, REAL_KEPT_PARAMS);

  let data;
  try {
    data = await loadLaporan(ctx, { label: raw.periode, basis: raw.basis });
  } catch (e) {
    unstable_rethrow(e);
    if (isSpaceNotFoundError(e)) notFound();
    console.error('[laporan] gagal memuat', errorTag(e));
    const p = parseLaporanParams({ label: raw.periode, basis: raw.basis });
    return (
      <LaporanFailed
        ruang={ctx.ruang}
        href={laporanHref(ctx.ruang, query, { periode: p.label, basis: p.basis })}
      />
    );
  }
  return <LaporanReal ruang={ctx.ruang} query={query} data={data} />;
}
