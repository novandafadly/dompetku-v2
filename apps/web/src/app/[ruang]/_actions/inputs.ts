import 'server-only';
import { z } from 'zod';
import { durationMs, flowId, taps } from '@/server/ledger/events';
import { suggestSchema } from '@/server/ledger/read';
import { createEntrySchema, createTransferSchema } from '@/server/ledger/write';

/**
 * Skema input action yang bukan sekadar skema wrapper (`server/ledger/write.ts`): batas tetap satu
 * sumber. Klien mengimpor tipenya dengan `import type` (berkas ini tidak masuk bundle klien).
 */

/** Catat: pengeluaran/pemasukan (`createEntry`) atau transfer satu ruang (`createTransfer`). */
export const saveCatatInput = z.discriminatedUnion('kind', [
  createEntrySchema,
  createTransferSchema.safeExtend({ kind: z.literal('transfer') }),
]);
export type SaveCatatInput = z.input<typeof saveCatatInput>;

/** Saran kategori: jam wajib (jam perangkat saat sheet dibuka, 0–23). */
export const suggestForInput = suggestSchema.extend({ hour: z.number().int().min(0).max(23) });
export type SuggestForInput = z.input<typeof suggestForInput>;

/**
 * Event Catat dari klien (tanpa `tanpa_pengeluaran`: event itu hanya dari
 * `markNoSpendDayAction`). `spaceKind` diisi server dari ruang yang di-resolve.
 */
export const catatEventInput = z.discriminatedUnion('event', [
  z.strictObject({ event: z.literal(['catat_disimpan', 'catat_batal']), flowId, taps, durationMs }),
  z.strictObject({
    event: z.literal('catat_dibuka'),
    flowId,
    taps: taps.optional(),
    durationMs: durationMs.optional(),
  }),
]);
export type CatatEventInput = z.input<typeof catatEventInput>;

export const entryIdInput = z.object({ entryId: z.uuid() });
