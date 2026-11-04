import { InfoIcon } from '@/components/ui/icons/info';

/** Dompet berisi: tombol arsip tidak dirender; kartu ini menjelaskan alasan dan jalan keluarnya. */
export function ArchiveBlockedCard({ name }: { name: string }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-hairline bg-surface px-4 py-3 text-label font-semibold text-text">
      <InfoIcon size={18} className="mt-0.5 shrink-0 text-text-soft" />
      {`${name} masih berisi saldo. Pindahkan isinya dengan Transfer, lalu arsipkan.`}
    </p>
  );
}
