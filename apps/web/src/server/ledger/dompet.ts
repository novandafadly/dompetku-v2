import 'server-only';
import { z } from 'zod';
import type { AccountVM, EntryVM } from '@/features/ledger/types';
import { accountEntries } from './read';
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

/**
 * `accounts` = dompet ruang ini yang sudah dimuat request ini (`ruangAccounts` di page, dipakai
 * bersama layout lewat React cache); lapisan `server/` tidak mengimpor `app/`, jadi diberikan.
 */
export async function loadDompetRiwayat(
  ctx: LedgerCtx,
  accountId: string,
  shown: number,
  accounts: AccountVM[],
): Promise<DompetRiwayat | null> {
  if (!z.uuid().safeParse(accountId).success) return null;
  const account = accounts.find((a) => a.id === accountId);
  if (account === undefined) return null;
  const { entries, opening, hasMore } = await accountEntries(ctx, accountId, shown);
  return { account, entries, opening, hasMore };
}
