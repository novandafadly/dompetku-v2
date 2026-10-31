import { Button } from '@/components/ui/button';
import { ArrowClockwiseIcon } from '@/components/ui/icons/arrow-clockwise';
import { PlusIcon } from '@/components/ui/icons/plus';
import { ErrorState, Skeleton } from '@/components/ui/state';
import { card, heroCard } from '@/components/ui/styles';

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden="true" className={`flex flex-col gap-3 p-4 ${card}`}>
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

/** B4: kerangka berbentuk isi akhir, teks "Memuat…" terlihat + role=status, tanpa denyut. */
export function BerandaLoading() {
  return (
    <div className="flex flex-col gap-3 laptop:max-w-250">
      <div className={`flex flex-col gap-3 p-4 ${heroCard}`}>
        <div className="flex items-start justify-between gap-2">
          <p role="status" className="text-label font-semibold text-text-muted">
            Memuat…
          </p>
          <Skeleton className="h-6 w-18" />
        </div>
        <Skeleton className="h-11 w-2/3" />
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-3 w-full" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-3.5 w-full" />
        ))}
      </div>
      <ListSkeleton rows={2} />
      <ListSkeleton rows={1} />
      <ListSkeleton rows={2} />
    </div>
  );
}

/** B5: sebab + tindakan. Catat tetap tersedia karena disimpan dulu di perangkat. */
export function BerandaError({ onRetry, onCatat }: { onRetry: () => void; onCatat: () => void }) {
  return (
    <div className="laptop:max-w-250">
      <ErrorState
        title="Beranda belum bisa dimuat"
        description="Sambungan ke server terputus. Catatan yang sudah tersimpan tidak hilang."
        actions={
          <>
            <Button onClick={onRetry}>
              <ArrowClockwiseIcon size={18} weight="bold" />
              Coba lagi
            </Button>
            <Button variant="secondary" onClick={onCatat}>
              <PlusIcon size={18} weight="bold" />
              Catat tetap bisa
            </Button>
          </>
        }
      />
    </div>
  );
}
