import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { focusRing } from '@/components/ui/styles';

/**
 * Baris galat di dalam kartu Beranda Bersama (salinan galat S8): ikon + teks `danger`, dan
 * `Coba lagi` berupa tautan biasa ke URL yang sama (muat ulang penuh, tanpa JS klien).
 */
export function CardError({ message, retryHref }: { message: string; retryHref: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 pb-3">
      <p className="flex min-w-0 flex-1 basis-40 items-center gap-1.5 text-meta font-semibold text-danger">
        <WarningCircleIcon size={16} weight="fill" className="shrink-0" />
        {message}
      </p>
      <a
        href={retryHref}
        className={`-my-2 inline-flex min-h-11 items-center rounded-md px-2 text-meta font-bold text-accent-text hover-pointer:underline ${focusRing}`}
      >
        Coba lagi
      </a>
    </div>
  );
}
