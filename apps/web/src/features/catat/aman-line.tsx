import { formatRupiah } from '@dompetku/domain';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import type { CatatSafe } from './source';

/**
 * Satu baris konteks di bawah nominal: Aman dipakai ruang ini saat ini, supaya angka yang dicari
 * sebelum belanja tetap terlihat di balik scrim. Bukan perkiraan sesudah simpan (lihat `CatatSafe`).
 * Tinggi baris dicadangkan selama angka belum ada, jadi sheet tidak bergeser saat angka tiba.
 */
export function AmanLine({ safe }: { safe: CatatSafe | null }) {
  const negative = safe !== null && safe.aman < 0;
  return (
    <p
      className={`flex min-h-4 items-center gap-1.5 text-caption font-medium tabular-nums ${
        negative ? 'text-danger' : 'text-text-muted'
      }`}
    >
      {safe === null ? null : (
        <>
          {negative ? <WarningCircleIcon size={14} weight="fill" className="shrink-0" /> : null}
          <span className="min-w-0 text-pretty">
            {negative
              ? `Aman dipakai ${formatRupiah(safe.aman)} · kurang dari kewajiban`
              : `Aman dipakai ${formatRupiah(safe.aman)}${
                  safe.perDay > 0 ? ` · ≈ ${formatRupiah(safe.perDay)} per hari` : ''
                }`}
          </span>
        </>
      )}
    </p>
  );
}
