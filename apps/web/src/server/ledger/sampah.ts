import 'server-only';
import type { AccountVM, TrashVM } from '@/features/ledger/types';
import { listAccountsTx, trashListTx } from './read';
import { withLedger } from './retry';
import type { LedgerCtx } from './write';

/**
 * Data Sampah nyata untuk satu ruang (page `[ruang]/sampah`, sesudah `requireDataUser` dan
 * `resolveSpace`): entri batal ≤ 90 hari (terbaru dulu, maks. 100) dan dompet ruang ini (saldo untuk
 * peringatan saat memulihkan). Hasilnya diserialisasi ke payload RSC: hanya data ruang ini, jadi
 * rute Bersama tidak pernah membawa data Pribadi (Review Focus 4).
 */
export interface SampahData {
  items: TrashVM[];
  accounts: AccountVM[];
}

/** Kedua bacaan berurutan di satu `withLedger` (satu koneksi pool per muat). */
export async function loadSampah(ctx: LedgerCtx): Promise<SampahData> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const items = await trashListTx(c, ctx);
    const accounts = await listAccountsTx(c, ctx);
    return { items, accounts };
  });
}
