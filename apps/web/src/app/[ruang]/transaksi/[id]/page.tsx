import { todayWIB } from '@dompetku/domain';
import { notFound } from 'next/navigation';
import { entryKindLabelVM, entryTitleVM, signedAmountVM } from '@/features/ledger/present';
import { buildHref, keptQuery, REAL_KEPT_PARAMS, validMonth } from '@/features/shell/hrefs';
import { isPrototype } from '@/server/env';
import { loadDetail } from '@/server/ledger/detail';
import { rethrowOrNotFound } from '@/server/ledger/page-guard';
import { errorTag } from '@/server/ledger/transaksi';
import { ruangContext } from '../../_real/context';
import { DetailFailed, DetailReal } from '../../_real/detail';
import { TransaksiDetailPage } from './view';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Prototipe: data demo, tanpa auth/DB. Nyata: gerbang di page (`ruangContext` =
 * `requireDataUser()` → `resolveSpace`), lalu `loadDetail` ruang ini lewat `withUser`. Id tidak
 * ada, bukan uuid, atau milik ruang lain = 404 (disamakan); entri batal tetap terbuka (S6-D3).
 * Galat loader = layar gagal muat; redirect/404 dari gerbang tetap dilempar. Tautan kembali
 * membawa `?bulan=` dari daftar.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ ruang: string; id: string }>;
  searchParams: SearchParams;
}) {
  if (isPrototype()) return <TransaksiDetailPage />;
  const ctx = await ruangContext(params);
  const { id } = await params;
  const today = todayWIB();
  const raw = await searchParams;
  const month = validMonth(typeof raw.bulan === 'string' ? raw.bulan : null, today);
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') sp.set(k, v);
  const listHref = buildHref(ctx.ruang, 'transaksi', keptQuery(sp, REAL_KEPT_PARAMS), {
    value: month,
    today,
  });

  let data;
  try {
    data = await loadDetail(ctx, id);
  } catch (e) {
    rethrowOrNotFound(e);
    console.error('[detail] gagal memuat', errorTag(e));
    return <DetailFailed listHref={listHref} />;
  }
  if (data === null) notFound();

  return (
    <DetailReal
      ruang={ctx.ruang}
      today={today}
      me={ctx.userId}
      listHref={listHref}
      data={data}
      labels={{
        title: entryTitleVM(data.entry),
        category: entryKindLabelVM(data.entry),
        amount: signedAmountVM(data.entry),
      }}
    />
  );
}
