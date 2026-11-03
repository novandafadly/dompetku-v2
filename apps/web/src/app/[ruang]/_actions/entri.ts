'use server';

import type { z } from 'zod';
import type { ActionResult, EntryVM, HistoryVM } from '@/features/ledger/types';
import { getEntry } from '@/server/ledger/read';
import {
  NotInSpaceError,
  restoreEntry,
  restoreEntrySchema,
  updateEntry,
  updateEntrySchema,
  voidEntry,
  voidEntrySchema,
} from '@/server/ledger/write';
import { actionContext, ledger, mutate, parseInput, query } from './context';
import { entryIdInput } from './inputs';

/**
 * Server Action Detail transaksi (endpoint publik; pola di `context.ts`). Entri yang disebut lewat
 * id wajib berada di ruang argumen (`NotInSpaceError` di wrapper = `not_found`).
 */

/** Ganti-penuh dengan `expectedVersion`; versi usang = `conflict` (lalu `reloadEntry`). */
export async function updateEntryAction(
  ruang: unknown,
  input: z.input<typeof updateEntrySchema>,
): Promise<ActionResult<{ entryId: string; version: number }>> {
  return mutate('updateEntryAction', actionContext(ruang), async (ctx) =>
    updateEntry(ledger(ctx), parseInput(updateEntrySchema, input)),
  );
}

/** Batalkan entri (masuk Sampah 90 hari); juga dipakai "Urungkan" sesudah simpan. */
export async function voidEntryAction(
  ruang: unknown,
  input: z.input<typeof voidEntrySchema>,
): Promise<ActionResult<{ version: number }>> {
  return mutate('voidEntryAction', actionContext(ruang), async (ctx) =>
    voidEntry(ledger(ctx), parseInput(voidEntrySchema, input)),
  );
}

/** Pulihkan dari Sampah atau dari banner entri batal; lewat 90 hari = `restore_window_closed`. */
export async function restoreEntryAction(
  ruang: unknown,
  input: z.input<typeof restoreEntrySchema>,
): Promise<ActionResult<{ version: number }>> {
  return mutate('restoreEntryAction', actionContext(ruang), async (ctx) =>
    restoreEntry(ledger(ctx), parseInput(restoreEntrySchema, input)),
  );
}

export interface ReloadedEntry {
  entry: EntryVM;
  history: HistoryVM[];
}

/** Nilai terbaru untuk layar konflik; entri tidak ada di ruang ini = `not_found`. */
export async function reloadEntry(
  ruang: unknown,
  entryId: string,
): Promise<ActionResult<ReloadedEntry>> {
  return query('reloadEntry', actionContext(ruang), async (ctx) => {
    const v = parseInput(entryIdInput, { entryId });
    const found = await getEntry(ledger(ctx), v.entryId);
    // Tidak ada di ruang ini (atau bukan uuid ruang ini) = DK404 → `not_found`.
    if (!found) throw new NotInSpaceError();
    return found;
  });
}
