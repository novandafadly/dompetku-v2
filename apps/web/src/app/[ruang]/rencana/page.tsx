import { notFound, unstable_rethrow } from 'next/navigation';
import { keptQuery, REAL_KEPT_PARAMS } from '@/features/shell/hrefs';
import { isPrototype } from '@/server/env';
import { isSpaceNotFoundError } from '@/server/ledger/errors';
import { loadRencana } from '@/server/ledger/rencana';
import { errorTag } from '@/server/ledger/transaksi';
import { ruangContext, ruangShell } from '../_real/context';
import { RencanaFailed, RencanaReal } from '../_real/rencana';
import { RencanaPage } from './view';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Prototipe: keadaan kosong tetap (data demo di klien). Nyata: gerbang di page (`ruangContext` =
 * `requireDataUser()` → `resolveSpace`), lalu anggaran periode berjalan, anggaran periode lalu
 * (salin, K13), tagihan, dompet, dan kategori ruang ini lewat `withLedger`. `?bagian=` rusak =
 * Anggaran. Galat loader = layar gagal muat; redirect/404 dari gerbang tetap dilempar. Halaman
 * berdata: dirender per request, `Cache-Control: no-store`.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ ruang: string }>;
  searchParams: SearchParams;
}) {
  if (isPrototype()) return <RencanaPage />;
  const ctx = await ruangContext(params);
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') sp.set(k, v);
  const bagian = sp.get('bagian') === 'tagihan' ? 'tagihan' : 'anggaran';

  let data;
  try {
    data = await loadRencana(ctx, { shell: ruangShell(ctx) });
  } catch (e) {
    unstable_rethrow(e);
    if (isSpaceNotFoundError(e)) notFound();
    console.error('[rencana] gagal memuat', errorTag(e));
    return <RencanaFailed />;
  }
  return (
    <RencanaReal
      ruang={ctx.ruang}
      bagian={bagian}
      query={keptQuery(sp, REAL_KEPT_PARAMS)}
      data={data}
    />
  );
}
