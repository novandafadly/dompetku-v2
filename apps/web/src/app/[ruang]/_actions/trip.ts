'use server';

import type { z } from 'zod';
import type { ActionResult } from '@/features/ledger/types';
import {
  archiveTrip,
  createTrip,
  createTripSchema,
  restoreTrip,
  setEntriesTrip,
  setEntriesTripSchema,
  tripIdSchema,
  updateTrip,
  updateTripSchema,
  type CreateTripValue,
} from '@/server/ledger/trip';
import { actionContext, ledger, mutate, parseInput } from './context';

/**
 * Server Action Trip (S15; endpoint publik, pola di `context.ts`). Kedua ruang; di Bersama semua
 * anggota boleh menulis (K1). Trip dan entri yang disebut lewat id wajib di ruang argumen
 * (`NotInSpaceError` di wrapper = `not_found`). Galat = kode tanpa nominal/nama (`name_taken`,
 * `trip_archived`, `trip_entry_invalid`, `trip_limit`, `split_locked`, ...); salinan dipilih UI
 * (`features/trip/galat.ts`). Galat kolom (`invalid`) datang dengan `field`: dari Zod (`name`,
 * `startsOn`, `endsOn`, `budget`) atau dari DB (`name`, `starts_on`, `ends_on`, `budget_amount`).
 * `Urungkan` Arsipkan = `restoreTripAction`; `Urungkan` Keluarkan/Masukkan = `setEntriesTripAction`.
 * Tanda trip di Catat/Ubah ikut `saveCatat`/`updateEntryAction` (`tripId`), bukan di sini.
 */

/** Trip baru (`clientId` stabil per pembukaan sheet: klik ganda/Coba lagi = replay). */
export async function createTripAction(
  ruang: unknown,
  input: z.input<typeof createTripSchema>,
): Promise<ActionResult<CreateTripValue>> {
  return mutate('createTripAction', actionContext(ruang), async (ctx) =>
    createTrip(ledger(ctx), parseInput(createTripSchema, input)),
  );
}

/** Ganti-penuh nama, tanggal, anggaran (`budget: null` = hapus); trip terarsip = `trip_archived`. */
export async function updateTripAction(
  ruang: unknown,
  input: z.input<typeof updateTripSchema>,
): Promise<ActionResult<{ tripId: string }>> {
  return mutate('updateTripAction', actionContext(ruang), async (ctx) =>
    updateTrip(ledger(ctx), parseInput(updateTripSchema, input)),
  );
}

/** Arsipkan trip (idempoten); pengeluaran tetap tercatat dan bertanda. */
export async function archiveTripAction(
  ruang: unknown,
  input: z.input<typeof tripIdSchema>,
): Promise<ActionResult<{ tripId: string; archived: boolean }>> {
  return mutate('archiveTripAction', actionContext(ruang), async (ctx) =>
    archiveTrip(ledger(ctx), parseInput(tripIdSchema, input)),
  );
}

/** Pulihkan trip terarsip (idempoten); juga `Urungkan` Arsipkan. */
export async function restoreTripAction(
  ruang: unknown,
  input: z.input<typeof tripIdSchema>,
): Promise<ActionResult<{ tripId: string; archived: boolean }>> {
  return mutate('restoreTripAction', actionContext(ruang), async (ctx) =>
    restoreTrip(ledger(ctx), parseInput(tripIdSchema, input)),
  );
}

/**
 * Tandai (`tripId`) atau lepas (`null`) 1..100 pengeluaran sekaligus, atomik: `Masukkan {n}`,
 * `Keluarkan dari trip`, dan `Urungkan`-nya. Hasil `changed` = banyak yang benar-benar berubah.
 */
export async function setEntriesTripAction(
  ruang: unknown,
  input: z.input<typeof setEntriesTripSchema>,
): Promise<ActionResult<{ changed: number; replayed: boolean }>> {
  return mutate('setEntriesTripAction', actionContext(ruang), async (ctx) =>
    setEntriesTrip(ledger(ctx), parseInput(setEntriesTripSchema, input)),
  );
}
