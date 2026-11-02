import 'server-only';
import { z } from 'zod';
import type { AccountVM, EntryVM } from '@/features/ledger/types';
import { accountEntries, listAccounts } from './read';
import type { LedgerCtx } from './write';

/**
 * Riwayat satu dompet nyata (page `[ruang]/dompet/[id]`, sesudah `requireDataUser` dan
 * `resolveSpace`): dompet + entri yang menyentuhnya. Hanya data ruang ini; id dompet ruang lain
 * (atau bukan uuid) disamakan dengan tidak ada (`null` = 404), jadi rute Bersama tidak pernah
 * membuka dompet Pribadi (Review Focus 4).
 */
export interface DompetRiwayat {
  account: AccountVM;
  /** Entri hidup terbaru dulu (tanpa Saldo awal), sebanyak `shown` paling banyak. */
  entries: EntryVM[];
  /** Entri pembuka dompet ini (Saldo awal); selalu di paling bawah riwayat. */
  opening: EntryVM[];
  /** Ada entri yang lebih lama dari yang ditampilkan. */
  hasMore: boolean;
}

export async function loadDompetRiwayat(
  ctx: LedgerCtx,
  accountId: string,
  shown: number,
): Promise<DompetRiwayat | null> {
  if (!z.uuid().safeParse(accountId).success) return null;
  const account = (await listAccounts(ctx)).find((a) => a.id === accountId);
  if (account === undefined) return null;
  const { entries, opening, hasMore } = await accountEntries(ctx, accountId, shown);
  return { account, entries, opening, hasMore };
}
