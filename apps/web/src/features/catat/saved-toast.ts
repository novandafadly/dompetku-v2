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

export const UNDO_FAILED = 'Belum bisa diurungkan. Buka transaksi itu untuk membatalkannya.';

/** "Urungkan" pada toast simpan; bila gagal, toast pemberitahuan (`role="status"`). */
export async function undoOrNotify<S>(
  undo: (saved: S) => Promise<boolean>,
  saved: S,
  notify: (t: { message: string; tone: 'info' }) => void,
): Promise<void> {
  let ok = false;
  try {
    ok = await undo(saved);
  } catch {
    ok = false;
  }
  if (!ok) notify({ message: UNDO_FAILED, tone: 'info' });
}
