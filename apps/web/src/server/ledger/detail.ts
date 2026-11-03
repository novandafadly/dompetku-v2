import 'server-only';
import type { AccountVM, CategoryVM, EntryVM, HistoryVM } from '@/features/ledger/types';
import type pg from 'pg';
import { z } from 'zod';
import { getEntryTx, listAccountsTx, listCategoriesTx } from './read';
import { withLedger } from './retry';
import type { LedgerCtx } from './write';

/**
 * Data Detail transaksi nyata (page `[ruang]/transaksi/[id]`, sesudah `requireDataUser` dan
 * `resolveSpace`): entri ruang ini (termasuk yang dibatalkan) + riwayat, dan dompet serta kategori
 * ruang ini untuk sheet Ubah. Hasilnya diserialisasi ke payload RSC: hanya data ruang ini, jadi rute
 * Bersama tidak pernah membawa data Pribadi (Review Focus 4).
 */
export interface DetailData {
  entry: EntryVM;
  history: HistoryVM[];
  accounts: AccountVM[];
  categories: CategoryVM[];
  /** Entri batal yang sudah lewat 90 hari (`restore_window_closed`, jam DB `app.now()`). */
  restoreClosed: boolean;
}

/** Batas pulihkan sama dengan `api.restore_entry`: dibatalkan sebelum `app.now() - 90 hari`. */
async function windowClosedTx(c: pg.PoolClient, ctx: LedgerCtx, entryId: string): Promise<boolean> {
  const { rows } = await c.query<{ closed: boolean }>(
    `select coalesce(e.voided_at < app.now() - interval '90 days', false) as closed
       from app.entries e
      where e.space_id = $1 and e.id = $2`,
    [ctx.spaceId, entryId],
  );
  return rows[0]?.closed ?? false;
}

/**
 * `null` bila id bukan uuid, tidak ada, atau milik ruang lain (disamakan; page = 404). Semua bacaan
 * berurutan di satu `withLedger` (satu koneksi pool per muat; 40001/40P01 mengulang seluruh blok).
 */
export async function loadDetail(ctx: LedgerCtx, entryId: string): Promise<DetailData | null> {
  if (!z.uuid().safeParse(entryId).success) return null;
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const found = await getEntryTx(c, ctx, entryId);
    if (found === null) return null;
    const accounts = await listAccountsTx(c, ctx);
    const categories = await listCategoriesTx(c, ctx);
    const restoreClosed = await windowClosedTx(c, ctx, found.entry.id);
    return { ...found, accounts, categories, restoreClosed };
  });
}
