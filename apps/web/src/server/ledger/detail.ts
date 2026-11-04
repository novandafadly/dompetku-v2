import 'server-only';
import type {
  AccountVM,
  CategoryVM,
  EntryVM,
  HistoryVM,
  TalanganVM,
} from '@/features/ledger/types';
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
  /**
   * Jumlah ruang yang diikuti pengguna (RLS `member_read`): "Pindahkan ke ruang lain" hanya
   * ditawarkan bila ≥ 2. Angka saja; tidak ada id ruang lain.
   */
  spaceCount: number;
  /** Talangan hidup (`reimbursable`): reimburse hidup dan sisanya; `null` untuk entri lain. */
  talangan: TalanganVM | null;
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

async function spaceCountTx(c: pg.PoolClient): Promise<number> {
  const { rows } = await c.query<{ n: number }>('select count(*)::int as n from app.spaces');
  return rows[0]?.n ?? 0;
}

/** Reimburse hidup sebuah talangan (ruang ini) dan sisanya; sisa tidak pernah negatif. */
async function talanganTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  entry: EntryVM,
): Promise<TalanganVM | null> {
  if (entry.kind !== 'expense' || entry.reimbursable !== true) return null;
  const { rows } = await c.query<{ id: string; occurred_on: string; amount: number }>(
    `select e.id, e.occurred_on, abs(l.amount) as amount
       from app.entries e
       join app.entry_lines l
         on l.space_id = e.space_id and l.entry_id = e.id and l.role = 'main'
      where e.space_id = $1 and e.reimburses_entry_id = $2 and e.voided_at is null
      order by e.occurred_on, e.created_at, e.id`,
    [ctx.spaceId, entry.id],
  );
  const items = rows.map((r) => ({ id: r.id, occurredOn: r.occurred_on, amount: r.amount }));
  const reimbursed = items.reduce((sum, i) => sum + i.amount, 0);
  return { items, reimbursed, remaining: Math.max(0, entry.amount - reimbursed) };
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
    const spaceCount = await spaceCountTx(c);
    const talangan = await talanganTx(c, ctx, found.entry);
    return { ...found, accounts, categories, restoreClosed, spaceCount, talangan };
  });
}
