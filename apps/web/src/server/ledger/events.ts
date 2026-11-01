import 'server-only';
import { z } from 'zod';
import { withUser, type Pools } from '../db';

/**
 * Event produk Catat (PRD §7, AFD §3) ke `app.product_events` (0004): insert langsung sebagai
 * `dompetku_web` (hak `select, insert`, policy `own`: `user_id = app.current_user_id()`).
 * Kolom eksplisit; tidak ada nominal, deskripsi, id entri, id dompet, atau id kategori. Objek
 * input ketat: kunci lain (mis. `amount`) ditolak Zod sebelum DB, bukan dibuang diam-diam.
 * `catat_disimpan`/`catat_batal` wajib `flowId`, `taps`, `durationMs` (sama dengan CHECK tabel).
 */
export interface ProductEventInput {
  event: 'catat_dibuka' | 'catat_disimpan' | 'catat_batal' | 'tanpa_pengeluaran';
  spaceKind: 'personal' | 'shared';
  flowId?: string;
  taps?: number;
  durationMs?: number;
}

const spaceKind = z.enum(['personal', 'shared']);
const flowId = z.uuid();
const taps = z.number().int().min(0).max(100);
const durationMs = z.number().int().min(0).max(3_600_000);

const productEventSchema = z.discriminatedUnion('event', [
  z.strictObject({
    event: z.literal(['catat_disimpan', 'catat_batal']),
    spaceKind,
    flowId,
    taps,
    durationMs,
  }),
  z.strictObject({
    event: z.literal(['catat_dibuka', 'tanpa_pengeluaran']),
    spaceKind,
    flowId: flowId.optional(),
    taps: taps.optional(),
    durationMs: durationMs.optional(),
  }),
]);

export async function recordProductEvent(
  pools: Pools,
  userId: string,
  e: ProductEventInput,
): Promise<void> {
  const v = productEventSchema.parse(e);
  await withUser(pools.app, userId, (c) =>
    c.query(
      `insert into app.product_events (user_id, space_kind, event, flow_id, taps, duration_ms)
       values (app.current_user_id(), $1::app.space_kind, $2, $3::uuid, $4::smallint, $5::int)`,
      [v.spaceKind, v.event, v.flowId ?? null, v.taps ?? null, v.durationMs ?? null],
    ),
  );
}
