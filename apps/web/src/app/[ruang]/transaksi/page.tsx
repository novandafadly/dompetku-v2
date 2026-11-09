import { todayWIB } from '@dompetku/domain';
import { keptQuery, REAL_KEPT_PARAMS, validMonth } from '@/features/shell/hrefs';
import { isPrototype } from '@/server/env';
import { rethrowOrNotFound } from '@/server/ledger/page-guard';
import { errorTag, loadTransaksi } from '@/server/ledger/transaksi';
import { ruangContext } from '../_real/context';
import { TransaksiFailed, TransaksiReal } from '../_real/transaksi';
import { TransaksiPage } from './view';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Prototipe: data demo, tanpa auth/DB. Nyata: gerbang di page (`ruangContext` =
 * `requireDataUser()` → `resolveSpace`), lalu loader ruang ini lewat `withUser`.
 * `?bulan=` dibaca di server: kosong, tidak sah, ganda, atau masa depan = bulan WIB berjalan
 * (`todayWIB`), tidak pernah 404/500. Galat loader = layar gagal muat (bukan galat rute);
 * redirect/404 dari gerbang tetap dilempar.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ ruang: string }>;
  searchParams: SearchParams;
}) {
  if (isPrototype()) return <TransaksiPage />;
  const ctx = await ruangContext(params);
  const today = todayWIB();
  const raw = await searchParams;
  const month = validMonth(typeof raw.bulan === 'string' ? raw.bulan : null, today);
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') sp.set(k, v);

  let data;
  try {
    data = await loadTransaksi(ctx, month);
  } catch (e) {
    rethrowOrNotFound(e);
    console.error('[transaksi] gagal memuat', errorTag(e));
    return <TransaksiFailed />;
  }
  // Entri tidak bisa sebelum dompet dibuka: bulan paling awal = dompet pertama (termasuk
  // terarsip); tanpa dompet = bulan berjalan.
  const current = today.slice(0, 7);
  const minMonth =
    data.firstMonth !== null && data.firstMonth < current ? data.firstMonth : current;

  return (
    <TransaksiReal
      ruang={ctx.ruang}
      today={today}
      month={month}
      minMonth={minMonth}
      query={keptQuery(sp, REAL_KEPT_PARAMS)}
      data={data}
    />
  );
}
