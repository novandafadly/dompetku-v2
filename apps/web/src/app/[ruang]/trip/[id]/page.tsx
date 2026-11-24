import { todayWIB } from '@dompetku/domain';
import { notFound } from 'next/navigation';
import { isPrototype } from '@/server/env';
import { rethrowOrNotFound } from '@/server/ledger/page-guard';
import { errorTag } from '@/server/ledger/transaksi';
import { loadTripDetail } from '@/server/ledger/trip';
import { ruangContext, ruangShell } from '../../_real/context';
import { TripDetailFailed, TripDetailReal } from '../../_real/trip-detail';

/**
 * Detail satu trip (`/{ruang}/trip/{id}`, S15-TR5..TR10): mode nyata di kedua ruang (prototipe =
 * 404). Trip tidak ada, milik ruang lain, atau id bukan uuid = `notFound()` seragam (tanpa orakel).
 * Nama pasangan (dialog Arsipkan Bersama dua anggota) diambil dari `ruangShell` yang sudah di-cache
 * per request bersama layout.
 */
export default async function Page({ params }: { params: Promise<{ ruang: string; id: string }> }) {
  if (isPrototype()) notFound();
  const ctx = await ruangContext(params);
  const { id } = await params;
  let data;
  let partnerName: string | null = null;
  try {
    const [detail, shell] = await Promise.all([loadTripDetail(ctx, id), ruangShell(ctx)]);
    data = detail;
    partnerName = shell.split?.partner.name ?? null;
  } catch (e) {
    rethrowOrNotFound(e);
    console.error('[trip-detail] gagal memuat', errorTag(e));
    return <TripDetailFailed ruang={ctx.ruang} />;
  }
  if (data === null) notFound();
  return (
    <TripDetailReal ruang={ctx.ruang} today={todayWIB()} data={data} partnerName={partnerName} />
  );
}
