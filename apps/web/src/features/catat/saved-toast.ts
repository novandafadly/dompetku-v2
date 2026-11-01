import { formatRupiah } from '@dompetku/domain';
import type { CatatType } from './source';

/** Toast sesudah simpan: `Tersimpan di {Ruang} · {Rp} dari {dompet}` (pemasukan: `ke {dompet}`). */
export function savedToast(
  label: string,
  amount: number,
  kind: CatatType,
  from: string,
  to?: string,
): string {
  const head = `Tersimpan di ${label} · ${formatRupiah(amount)}`;
  if (kind === 'income') return `${head} ke ${from}`;
  if (kind === 'transfer') return `${head} dari ${from} ke ${to ?? ''}`;
  return `${head} dari ${from}`;
}
