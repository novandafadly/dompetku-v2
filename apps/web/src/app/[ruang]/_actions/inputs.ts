import 'server-only';
import { z } from 'zod';
import { durationMs, flowId, taps } from '@/server/ledger/events';
import { suggestSchema } from '@/server/ledger/read';
import {
  createEntrySchema,
  createSpaceTransferSchema,
  createTransferSchema,
  moveEntrySchema,
} from '@/server/ledger/write';

/**
 * Skema input action yang bukan sekadar skema wrapper (`server/ledger/write.ts`): batas tetap satu
 * sumber. Klien mengimpor tipenya dengan `import type` (berkas ini tidak masuk bundle klien).
 */

/** Ruang tujuan action antar ruang: slug saja; server me-resolve `space_id` (`targetSpace`). */
export const toRuang = z.enum(['pribadi', 'bersama']);

/**
 * Uuid ruang dari klien ditolak, bukan diabaikan: ruang tujuan selalu slug (`toRuang`). Kunci
 * disebut eksplisit agar galatnya menunjuk `toSpaceId`; kunci asing lain ditolak `strictObject`.
 */
const noRawSpaceId = { toSpaceId: z.never().optional() };

/**
 * Transfer antar ruang (S7): dompet sumber di ruang argumen, dompet tujuan di `toRuang`.
 * `description` hanya tersimpan di kaki Pribadi, `sharedNote` hanya di kaki Bersama (DB).
 */
const spaceTransferInput = z.strictObject({
  ...createSpaceTransferSchema.omit({ toSpaceId: true }).shape,
  kind: z.literal('space_transfer'),
  toRuang,
  ...noRawSpaceId,
  fee: createSpaceTransferSchema.shape.fee.optional(),
  allowNegative: z.boolean().optional(),
});

/**
 * Catat: pengeluaran/pemasukan (`createEntry`, termasuk talangan `reimbursable`), transfer satu
 * ruang (`createTransfer`), atau transfer antar ruang (`createSpaceTransfer`).
 */
export const saveCatatInput = z.discriminatedUnion('kind', [
  createEntrySchema,
  createTransferSchema.safeExtend({ kind: z.literal('transfer') }),
  spaceTransferInput,
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

/** Pindahkan ke ruang lain: ruang tujuan = slug; `keepDescription` hanya berarti ke Bersama. */
export const moveEntryInput = z.strictObject({
  ...moveEntrySchema.omit({ toSpaceId: true }).shape,
  toRuang,
  ...noRawSpaceId,
});
export type MoveEntryInput = z.input<typeof moveEntryInput>;

export const moveTargetsInput = z.object({ toRuang });
