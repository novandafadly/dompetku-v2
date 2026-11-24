import { todayWIB } from '@dompetku/domain';
import { notFound } from 'next/navigation';
import { isPrototype } from '@/server/env';
import { rethrowOrNotFound } from '@/server/ledger/page-guard';
import { errorTag } from '@/server/ledger/transaksi';
import { loadTrips } from '@/server/ledger/trip';
import { ruangContext } from '../_real/context';
import { TripFailed, TripReal } from '../_real/trip';

/**
 * Menu → Trip (S15-TR2): mode nyata di Pribadi dan Bersama (prototipe tetap "Segera": 404).
 * Gerbang di page (`ruangContext` = `requireDataUser()` → `resolveSpace`), lalu `loadTrips` lewat
 * `withLedger`. Galat loader = layar gagal muat; redirect/404 dari gerbang tetap dilempar.
 */
export default async function Page({ params }: { params: Promise<{ ruang: string }> }) {
  if (isPrototype()) notFound();
  const ctx = await ruangContext(params);
  let trips;
  try {
    trips = await loadTrips(ctx);
  } catch (e) {
    rethrowOrNotFound(e);
    console.error('[trip] gagal memuat', errorTag(e));
    return <TripFailed ruang={ctx.ruang} />;
  }
  return <TripReal ruang={ctx.ruang} today={todayWIB()} trips={trips} />;
}
