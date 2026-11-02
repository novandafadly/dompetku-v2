import type { ReactNode } from 'react';
import { ErrorState, LoadingRegion, Skeleton } from '@/components/ui/state';
import { card } from '@/components/ui/styles';

/** Id judul Sampah: sesudah daftar habis dipulihkan, fokus pindah ke judul (S6-S1). */
export const SAMPAH_TITLE_ID = 'sampah-judul';

/** Salinan tetap S6-S1. */
export const TRASH_COPY = {
  empty: 'Sampah kosong. Transaksi yang dibatalkan bisa dipulihkan di sini selama 90 hari.',
  loading: 'Memuat Sampah…',
  failedTitle: 'Sampah belum bisa dimuat.',
  failedHint: 'Periksa koneksi lalu coba lagi.',
} as const;

/** Memuat: skeleton tiga baris + teks terlihat `role="status"`. */
export function TrashLoading() {
  return (
    <LoadingRegion label={TRASH_COPY.loading}>
      <div aria-hidden="true" className={`flex flex-col gap-4 px-4 py-3 ${card}`}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
            </div>
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

/** Gagal muat (pola B5, sama dengan Transaksi): salinan tetap + tindakan dari pemanggil. */
export function TrashFailed({ actions }: { actions: ReactNode }) {
  return (
    <ErrorState
      title={TRASH_COPY.failedTitle}
      description={TRASH_COPY.failedHint}
      actions={actions}
    />
  );
}
