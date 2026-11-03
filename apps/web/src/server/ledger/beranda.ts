import 'server-only';
import type { AccountVM, EntryVM, SafeToSpendVM, TodayStatusVM } from '@/features/ledger/types';
import type pg from 'pg';
import {
  hasExpenseTx,
  listAccountsTx,
  recentEntriesTx,
  safeToSpendTx,
  todayStatusTx,
} from './read';
import { withLedger } from './retry';
import type { LedgerCtx } from './write';

/**
 * Data Beranda nyata untuk satu ruang (page `[ruang]/beranda`, sesudah `requireDataUser` dan
 * `resolveSpace`). Hanya data ruang ini, ditambah satu boolean rumah tangga (`invite`): hasilnya
 * diserialisasi ke payload RSC, jadi rute Bersama tidak pernah membawa data Pribadi.
 * Anggaran, tagihan, dan feed aktivitas belum dimuat (S8/S9).
 */
export interface BerandaData {
  safe: SafeToSpendVM;
  today: TodayStatusVM;
  /**
   * Ada dompet operasional aktif: tanpa itu kartu utama tidak menampilkan angka (B3), dan
   * checklist "Tambah dompet" belum selesai (setara prototipe).
   */
  hasOperasional: boolean;
  /** Ada pengeluaran hidup: checklist "Catat satu pengeluaran". */
  hasExpense: boolean;
  /** 5 entri hidup terbaru ruang ini. */
  recent: EntryVM[];
  /**
   * Hanya ruang Pribadi: user pemilik Bersama dan Bersama belum berisi dua orang (checklist
   * "Undang Farida"). Rute Bersama selalu `false` (tidak dikueri).
   */
  invite: boolean;
}

const RECENT = 5;

/**
 * Pemilik Bersama dan anggota Bersama < 2 (`app.space_roster`, konteks user). Tanpa fungsi SQL
 * baru: kueri sederhana atas ruang `shared` yang user anggotai (konteks `app.user_id` transaksi
 * pemanggil; tidak bergantung pada ruang `assert_member`).
 */
async function inviteOpenTx(c: pg.PoolClient): Promise<boolean> {
  const { rows } = await c.query<{ role: string; members: number }>(
    `select m.role::text as role,
            (select count(*) from app.space_roster(s.id))::int as members
       from app.spaces s
       join app.space_members m on m.space_id = s.id and m.user_id = app.current_user_id()
      where s.kind = 'shared'
      limit 1`,
  );
  const r = rows[0];
  return r?.role === 'owner' && r.members < 2;
}

/**
 * Semua bacaan Beranda BERURUTAN di satu `withLedger` (satu koneksi pool per muat, bukan satu per
 * kueri; 40001/40P01 mengulang seluruh blok). `accounts`: dompet ruang ini yang sudah dimuat untuk
 * request yang sama (opsi Catat layout, di-`cache` per request; transaksinya sendiri, jadi satu
 * muat Beranda = paling banyak 2 koneksi); bila kosong dimuat di transaksi ini. Promise itu
 * ditunggu DI LUAR transaksi: koneksi tidak pernah ditahan sambil menunggu koneksi lain (pool
 * habis tidak boleh saling kunci).
 */
export async function loadBeranda(
  ctx: LedgerCtx & { kind: 'personal' | 'shared' },
  opts: { accounts?: Promise<AccountVM[]> } = {},
): Promise<BerandaData> {
  const given = opts.accounts;
  const [read, givenAccounts] = await Promise.all([
    withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
      const safe = await safeToSpendTx(c, ctx);
      const today = await todayStatusTx(c, ctx);
      const accounts = given === undefined ? await listAccountsTx(c, ctx) : null;
      const expense = await hasExpenseTx(c, ctx);
      const recent = await recentEntriesTx(c, ctx, RECENT);
      const invite = ctx.kind === 'personal' ? await inviteOpenTx(c) : false;
      return { safe, today, accounts, expense, recent, invite };
    }),
    given ?? null,
  ]);
  const accounts = givenAccounts ?? read.accounts ?? [];
  return {
    safe: read.safe,
    today: read.today,
    hasOperasional: accounts.some((a) => a.pocket === 'operasional' && !a.archived),
    hasExpense: read.expense,
    recent: read.recent,
    invite: read.invite,
  };
}
