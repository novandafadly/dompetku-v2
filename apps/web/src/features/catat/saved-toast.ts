import { formatRupiah } from '@dompetku/domain';
import { newClientId } from './client-id';
import type { CatatType } from './source';

/**
 * Toast sesudah simpan: `Tersimpan di {Ruang} · {Rp} dari {dompet}` (pemasukan: `ke {dompet}`;
 * antar ruang: `ke {Ruang tujuan}`; talangan: `… · Talangan kantor`).
 */
export function savedToast(
  label: string,
  amount: number,
  kind: CatatType,
  from: string,
  to?: string,
  extra: { toRuang?: string; reimbursable?: boolean } = {},
): string {
  const head = `Tersimpan di ${label} · ${formatRupiah(amount)}`;
  if (kind === 'income') return `${head} ke ${from}`;
  // Antar ruang (S7-C1): hanya nama ruang tujuan, tanpa nama dompet (batas Pribadi/Bersama).
  if (kind === 'transfer' && extra.toRuang !== undefined) return `${head} ke ${extra.toRuang}`;
  if (kind === 'transfer') return `${head} dari ${from} ke ${to ?? ''}`;
  return `${head} dari ${from}${extra.reimbursable === true ? ' · Talangan kantor' : ''}`;
}

export const UNDO_FAILED = 'Belum bisa diurungkan. Buka transaksi itu untuk membatalkannya.';
/** Urungkan sesudah Batalkan (Detail) gagal: entri tetap batal, jadi arahannya memulihkan. */
export const UNDO_VOID_FAILED = 'Belum bisa diurungkan. Buka transaksi itu untuk memulihkannya.';

type Notify = (t: { message: string; tone: 'info' }) => void;

/** "Urungkan" pada toast simpan; bila gagal, toast pemberitahuan (`role="status"`). */
export async function undoOrNotify<S>(
  undo: (saved: S) => Promise<boolean>,
  saved: S,
  notify: Notify,
  failed: string = UNDO_FAILED,
): Promise<void> {
  let ok = false;
  try {
    ok = await undo(saved);
  } catch {
    ok = false;
  }
  if (!ok) notify({ message: failed, tone: 'info' });
}

/**
 * Aksi "Urungkan" untuk satu toast batal: pulihkan versi hasil batal. Satu clientId per toast
 * (klik berulang = permintaan yang sama, idempoten di server); klik saat masih jalan diabaikan.
 */
export function undoVoidOnce(
  restore: (req: {
    clientId: string;
    entryId: string;
    expectedVersion: number;
  }) => Promise<{ ok: boolean }>,
  entryId: string,
  version: number,
  notify: Notify,
): () => Promise<void> {
  const clientId = newClientId();
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await undoOrNotify(
        async (v: number) => (await restore({ clientId, entryId, expectedVersion: v })).ok,
        version,
        notify,
        UNDO_VOID_FAILED,
      );
    } finally {
      running = false;
    }
  };
}
