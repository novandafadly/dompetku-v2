import type { Route } from 'next';
import Link from 'next/link';
import { InfoIcon } from '@/components/ui/icons/info';
import { focusRing } from '@/components/ui/styles';

/**
 * Dompet tidak bisa diarsipkan: tombol arsip tidak dirender; kartu ini menjelaskan alasan dan jalan
 * keluarnya. Default = saldo masih ada; `goal` (S13-TJ11) = dompet tabungan masih punya tujuan aktif
 * (`goal.href` ke Rencana > Tujuan).
 */
export function ArchiveBlockedCard({
  name,
  goal,
}: {
  name: string;
  goal?: { name: string; href: Route };
}) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-xl border border-hairline bg-surface px-4 py-3">
      <p className="flex items-start gap-2 text-label font-semibold text-text">
        <InfoIcon size={18} className="mt-0.5 shrink-0 text-text-soft" />
        {goal === undefined
          ? `${name} masih berisi saldo. Pindahkan isinya dengan Transfer, lalu arsipkan.`
          : `${name} masih punya tujuan aktif ${goal.name}. Selesaikan atau arsipkan tujuannya dulu, lalu arsipkan dompet ini.`}
      </p>
      {goal === undefined ? null : (
        <Link
          href={goal.href}
          className={`inline-flex min-h-11 items-center rounded-md px-1 text-label font-bold text-accent-text hover-pointer:underline ${focusRing}`}
        >
          Lihat tujuan
        </Link>
      )}
    </div>
  );
}
