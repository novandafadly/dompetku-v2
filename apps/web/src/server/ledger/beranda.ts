import 'server-only';
import { todayWIB, type IsoDate } from '@dompetku/domain';
import type { AccountVM, EntryVM, SafeToSpendVM, TodayStatusVM } from '@/features/ledger/types';
import type { ActivityItemVM, ContributionVM } from '@/features/bersama/types';
import type pg from 'pg';
import { bersamaBerandaTx } from './bersama';
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
 * Bersama berisi dua anggota juga memuat feed Aktivitas dan Kontribusi (S8) di transaksi yang sama.
 * Anggaran dan tagihan belum dimuat (S9).
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
  /**
   * Hanya rute Bersama (`null` di Pribadi): keadaan ruang untuk S7-B1 (satu anggota) dan S7-B2
   * (kosong). `pendingInvite` hanya diisi untuk pemilik Bersama dengan satu anggota (`null` =
   * belum ada undangan menunggu); bukan pemilik tidak pernah menerima email undangan.
   */
  bersama: BerandaBersama | null;
}

export interface BerandaBersama {
  members: number;
  isOwner: boolean;
  /** Tanpa dompet operasional aktif dan tanpa entri hidup (saldo awal juga entri). */
  empty: boolean;
  pendingInvite?: { email: string; expiresOn: IsoDate } | null;
  /** Anggota lain dari roster (salinan `Yang kamu dan {Nama} …`, S8-A1/O2); `null` bila solo. */
  partner: { name: string; initial: string } | null;
  /**
   * S8-A1: 5 peristiwa terbaru (`api.shared_activity`), hanya bila anggota ≥ 2 (`null` = solo,
   * kartu S7-B1). `'error'` = bacaan feed gagal (savepoint): kartu menampilkan galat, Beranda tetap.
   */
  activity: ActivityItemVM[] | 'error' | null;
  /** S8-K1: Kontribusi bulan kalender WIB berjalan (K3); `null` = solo, `'error'` = gagal dimuat. */
  contributions: ContributionVM | 'error' | null;
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
 * Keadaan ruang Bersama (S7-B1/B2) di transaksi baca yang sama. Anggota dari `app.space_roster`,
 * peran dari baris keanggotaan user. `anyEntry` = ada entri hidup (saldo awal juga entri); "kosong"
 * dihitung pemanggil bersama `hasOperasional`. Undangan menunggu dibaca lewat `api.list_invitations`
 * (konteks user transaksi ini, hanya undangan buatannya) dan hanya untuk pemilik berisi satu orang.
 */
async function bersamaTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
): Promise<{
  members: number;
  isOwner: boolean;
  anyEntry: boolean;
  pendingInvite?: { email: string; expiresOn: IsoDate } | null;
}> {
  const { rows } = await c.query<{ role: string; members: number; any_entry: boolean }>(
    `select m.role::text as role,
            (select count(*) from app.space_roster($1))::int as members,
            exists (select 1 from app.entries e
                     where e.space_id = $1 and e.voided_at is null) as any_entry
       from app.space_members m
      where m.space_id = $1 and m.user_id = app.current_user_id()`,
    [ctx.spaceId],
  );
  const r = rows[0];
  const members = r?.members ?? 1;
  const isOwner = r?.role === 'owner';
  const anyEntry = r?.any_entry ?? false;
  if (!isOwner || members >= 2) return { members, isOwner, anyEntry };
  const inv = await c.query<{ email: string; expires_at: Date }>(
    `select email, expires_at from api.list_invitations() where status = 'pending' limit 1`,
  );
  const row = inv.rows[0];
  return {
    members,
    isOwner,
    anyEntry,
    pendingInvite: row ? { email: row.email, expiresOn: todayWIB(row.expires_at) } : null,
  };
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
      const bersama = ctx.kind === 'shared' ? await bersamaTx(c, ctx) : null;
      // Feed dan Kontribusi hanya untuk Bersama berisi ≥ 2 anggota (S8); koneksi yang sama.
      const extra =
        bersama && bersama.members >= 2
          ? await bersamaBerandaTx(c, ctx)
          : { partner: null, activity: null, contributions: null };
      return { safe, today, accounts, expense, recent, invite, bersama, extra };
    }),
    given ?? null,
  ]);
  const accounts = givenAccounts ?? read.accounts ?? [];
  const hasOperasional = accounts.some((a) => a.pocket === 'operasional' && !a.archived);
  let bersama: BerandaBersama | null = null;
  if (read.bersama) {
    const { anyEntry, ...rest } = read.bersama;
    bersama = { ...rest, empty: !hasOperasional && !anyEntry, ...read.extra };
  }
  return {
    safe: read.safe,
    today: read.today,
    hasOperasional,
    hasExpense: read.expense,
    recent: read.recent,
    invite: read.invite,
    bersama,
  };
}
