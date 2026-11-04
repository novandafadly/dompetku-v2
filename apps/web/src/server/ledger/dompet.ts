import 'server-only';
import { z } from 'zod';
import type pg from 'pg';
import type { AccountVM, EntryVM, ReimbursableVM } from '@/features/ledger/types';
import { accountEntries, accountEntriesTx, type AccountRow, mapAccountRow } from './read';
import { openReimbursablesTx } from './reimburse';
import { withLedger } from './retry';
import type { LedgerCtx } from './write';

/**
 * Pelengkap daftar Dompet (page `[ruang]/dompet`): dompet terarsip dan, hanya di Pribadi,
 * talangan yang menunggu reimburse. Satu transaksi. Ruang Bersama tidak punya talangan: kueri
 * tidak dijalankan, jadi datanya tidak pernah dimuat atau dikirim di rute Bersama (S7-W4).
 */
export interface DompetDaftar {
  /** Dompet terarsip ruang ini (saldo 0), untuk kartu `Diarsipkan`. */
  archived: AccountVM[];
  reimbursables: ReimbursableVM[];
}

async function archivedTx(c: pg.PoolClient, ctx: LedgerCtx, accountId?: string) {
  const { rows } = await c.query<AccountRow>(
    `select a.id, a.name, a.pocket::text as pocket, a.wallet_type::text as wallet_type,
            a.opened_on, a.archived_at is not null as archived, b.balance
       from app.accounts a
       join app.account_balances b on b.space_id = a.space_id and b.account_id = a.id
      where a.space_id = $1 and a.archived_at is not null
        and ($2::uuid is null or a.id = $2::uuid)
      order by a.archived_at desc, a.id`,
    [ctx.spaceId, accountId ?? null],
  );
  return rows.map(mapAccountRow);
}

export async function loadDompetDaftar(
  ctx: LedgerCtx,
  kind: 'personal' | 'shared',
): Promise<DompetDaftar> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => ({
    archived: await archivedTx(c, ctx),
    reimbursables: kind === 'personal' ? await openReimbursablesTx(c, ctx) : [],
  }));
}

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
  const active = accounts.find((a) => a.id === accountId);
  if (active !== undefined) {
    const { entries, opening, hasMore } = await accountEntries(ctx, accountId, shown);
    return { account: active, entries, opening, hasMore };
  }
  // Dompet terarsip tidak ada di `accounts` (daftar aktif) tetapi riwayatnya tetap bisa dibuka;
  // dompet dan entrinya dibaca dalam satu transaksi.
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const account = (await archivedTx(c, ctx, accountId))[0];
    if (account === undefined) return null;
    const { entries, opening, hasMore } = await accountEntriesTx(c, ctx, accountId, shown);
    return { account, entries, opening, hasMore };
  });
}
