import 'server-only';
import type { AccountVM, TrashVM } from '@/features/ledger/types';
import { listAccounts, trashList } from './read';
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

export async function loadSampah(ctx: LedgerCtx): Promise<SampahData> {
  const [items, accounts] = await Promise.all([trashList(ctx), listAccounts(ctx)]);
  return { items, accounts };
}
