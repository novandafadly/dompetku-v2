import type { DemoState, Ruang } from '@dompetku/demo-data';
import { addDays, type IsoDate } from '@dompetku/domain';
import { entryToVM } from '@/features/transaksi/demo-vm';
import type { TrashVM } from '@/features/ledger/types';
import { SAMPAH_HARI } from '@/features/ledger/sampah-window';

/** Jendela pulihkan (BSD §9.1): sama dengan `api.trash_list` dan `api.restore_entry`. */
const WINDOW_DAYS = SAMPAH_HARI;
/** Sama dengan `api.trash_list(p_limit => 100)` di mode nyata. */
const LIMIT = 100;

/**
 * Sampah prototipe: entri batal ruang ini yang `voidedAt`-nya ≤ 90 hari terhadap `today` (tanggal
 * WIB), terbaru dulu. `purgeAfter` = waktu batal + 90 hari. Store demo yang memulihkan.
 */
export function trashItems(state: DemoState, ruang: Ruang, today: IsoDate): TrashVM[] {
  const oldest = addDays(today, -WINDOW_DAYS);
  return state.entries
    .filter(
      (e) => e.ruang === ruang && e.voidedAt !== undefined && e.voidedAt.slice(0, 10) >= oldest,
    )
    .sort((a, b) => (b.voidedAt ?? '').localeCompare(a.voidedAt ?? '') || b.id.localeCompare(a.id))
    .slice(0, LIMIT)
    .map((e) => {
      const at = e.voidedAt ?? '';
      return {
        entry: entryToVM(state, e),
        purgeAfter: addDays(at.slice(0, 10), WINDOW_DAYS) + at.slice(10),
      };
    });
}
