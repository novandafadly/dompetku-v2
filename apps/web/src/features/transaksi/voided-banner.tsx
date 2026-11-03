import type { ReactNode } from 'react';
import { ArrowCounterClockwiseIcon } from '@/components/ui/icons/arrow-counter-clockwise';
import { SAMPAH_HARI } from '@/features/ledger/sampah-window';

/** Salinan tetap S6-D3 dan S6-S1 (lewat 90 hari). */
export const VOIDED_COPY = {
  text: 'Transaksi ini sudah dibatalkan.',
  restore: 'Pulihkan',
  closed: `Lewat ${String(SAMPAH_HARI)} hari, transaksi ini tidak bisa dipulihkan lagi.`,
} as const;

/**
 * S6-D3: banner di atas kartu atas Detail entri yang dibatalkan (konten statis halaman, bukan
 * `role="status"`). Ikon + teks; aksi (`Pulihkan`, teks lewat 90 hari, peringatan saldo) diisi
 * pemanggil. Di bawah 360 px aksi turun ke bawah teks.
 */
export function VoidedBanner({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3 narrow:flex-row narrow:flex-wrap narrow:items-center">
      <p className="flex min-w-0 flex-1 items-center gap-2 text-body font-semibold text-text">
        <ArrowCounterClockwiseIcon size={18} className="shrink-0 text-text-soft" />
        {VOIDED_COPY.text}
      </p>
      {children}
    </div>
  );
}
