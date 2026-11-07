import type { ReactNode } from 'react';
import { ArrowClockwiseIcon } from '@/components/ui/icons/arrow-clockwise';
import { ChartBarIcon } from '@/components/ui/icons/chart-bar';
import { buttonClass } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/ui/state';
import { card, heroCard } from '@/components/ui/styles';

/** Kosong (S9-LP5): tidak ada entri hidup di periode ini; `action` = tombol Catat (pulau klien). */
export function LaporanEmptyCard({ action }: { action: ReactNode }) {
  return (
    <EmptyState
      tone="accent"
      icon={<ChartBarIcon size={28} />}
      title="Belum ada transaksi di periode ini."
      headingLevel={2}
      description="Catat pengeluaran atau pemasukan, lalu ringkasannya muncul di sini."
      action={action}
    />
  );
}

/** Galat muat (S9-LP7): `Coba lagi` adalah tautan ke alamat yang sama (jalan tanpa JS). */
export function LaporanFailedCard({ retryHref }: { retryHref: string }) {
  return (
    <ErrorState
      title="Laporan belum bisa dimuat."
      description="Sambungan ke server terputus. Catatan yang sudah tersimpan tidak hilang."
      actions={
        // Tautan biasa (bukan next/link): memuat ulang halaman dari server.
        <a href={retryHref} className={buttonClass('primary')}>
          <ArrowClockwiseIcon size={18} weight="bold" />
          Coba lagi
        </a>
      }
    />
  );
}

/** Memuat (S9-LP6): kerangka berbentuk isi akhir, tanpa denyut. */
export function LaporanLoading() {
  return (
    <LoadingRegion label="Memuat laporan…">
      <Skeleton className="h-11" />
      <Skeleton className="h-11" />
      <div className={`flex flex-col gap-3 p-4 ${heroCard}`}>
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-11 w-2/3" />
        <Skeleton className="h-24" />
      </div>
      <div className={`flex flex-col gap-3 p-4 ${card}`}>
        <Skeleton className="h-4 w-2/5" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-11" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-xl" />
    </LoadingRegion>
  );
}
