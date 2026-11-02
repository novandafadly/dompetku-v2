import 'server-only';
import type { AccountVM, EntryVM, SafeToSpendVM, TodayStatusVM } from '@/features/ledger/types';
import { withUser } from '../db';
import { hasExpense, listAccounts, recentEntries, safeToSpend, todayStatus } from './read';
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
 * baru: kueri sederhana atas ruang `shared` yang user anggotai.
 */
async function inviteOpen(ctx: LedgerCtx): Promise<boolean> {
  return withUser(ctx.pools.app, ctx.userId, async (c) => {
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
  });
}

/**
 * `accounts`: dompet ruang ini yang sudah dimuat untuk request yang sama (layout memakai
 * `listAccounts` yang di-`cache` per request); bila kosong dimuat di sini.
 */
export async function loadBeranda(
  ctx: LedgerCtx & { kind: 'personal' | 'shared' },
  opts: { accounts?: Promise<AccountVM[]> } = {},
): Promise<BerandaData> {
  const [safe, today, accounts, expense, recent, invite] = await Promise.all([
    safeToSpend(ctx),
    todayStatus(ctx),
    opts.accounts ?? listAccounts(ctx),
    hasExpense(ctx),
    recentEntries(ctx, RECENT),
    ctx.kind === 'personal' ? inviteOpen(ctx) : false,
  ]);
  return {
    safe,
    today,
    hasOperasional: accounts.some((a) => a.pocket === 'operasional' && !a.archived),
    hasExpense: expense,
    recent,
    invite,
  };
}
