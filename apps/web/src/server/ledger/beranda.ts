import 'server-only';
import { todayWIB, type IsoDate } from '@dompetku/domain';
import type {
  AccountVM,
  EntryVM,
  PeriodVM,
  SafeToSpendFullVM,
  TodayStatusVM,
} from '@/features/ledger/types';
import type { ActivityItemVM, ContributionVM } from '@/features/bersama/types';
import { amanStatus } from '@/features/beranda/aman-status';
import { NEAR_PCT } from '@/features/rencana/copy';
import type { BillDueVM, BudgetOverviewVM } from '@/features/rencana/types';
import type pg from 'pg';
import { bersamaBerandaTx } from './bersama';
import { guarded } from './guarded';
import {
  hasExpenseTx,
  listAccountsTx,
  payPeriodTx,
  recentEntriesTx,
  safeToSpendTx,
  spendPaceTx,
  todayStatusTx,
} from './read';
import { billsDueTx, budgetOverviewTx } from './rencana';
import { withLedger } from './retry';
import type { LedgerCtx } from './write';

/**
 * Data Beranda nyata untuk satu ruang (page `[ruang]/beranda`, sesudah `requireDataUser` dan
 * `resolveSpace`). Hanya data ruang ini, ditambah satu boolean rumah tangga (`invite`): hasilnya
 * diserialisasi ke payload RSC, jadi rute Bersama tidak pernah membawa data Pribadi.
 * Bersama berisi dua anggota juga memuat feed Aktivitas dan Kontribusi (S8) di transaksi yang sama.
 * S9: aman dipakai lengkap sampai akhir periode gajian, `Tagihan 7 hari`, `Anggaran hampir habis`
 * (masing-masing di savepoint sendiri: galat = kartu `'error'`, Beranda tetap).
 */
export interface BerandaData {
  /** Periode gajian berjalan (K1; aturan kosong = bulan kalender). */
  period: PeriodVM;
  safe: SafeToSpendFullVM;
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
  /** S9-BR2 `Tagihan 7 hari`; `'error'` = gagal dimuat (savepoint). */
  billsDue: BerandaBillsVM | 'error';
  /** S9-BR2 `Anggaran hampir habis`; `'error'` = gagal dimuat (savepoint). */
  budgetsNear: BerandaBudgetsVM | 'error';
}

export interface BerandaBillsVM {
  /** Kemunculan terbuka jatuh tempo ≤ hari ini + 7 (termasuk lewat), urut jatuh tempo. */
  items: BillDueVM[];
  /** Ruang punya tagihan (aktif) sama sekali: membedakan dua salinan kosong. */
  hasBills: boolean;
}

export interface BerandaBudgetsVM {
  /** Anggaran periode ini dengan pct ≥ 80, urut pct turun (lalu urutan Rencana). */
  items: BudgetOverviewVM[];
  /** Ruang punya anggaran di periode ini: membedakan dua salinan kosong. */
  hasBudgets: boolean;
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
  /** S8-K1: Kontribusi periode gajian berjalan (K10); `null` = solo, `'error'` = gagal dimuat. */
  contributions: ContributionVM | 'error' | null;
}

const RECENT = 5;
/** T8 m0a: `Tagihan 7 hari` = jatuh tempo ≤ hari ini + 7 (WIB server). */
const BILLS_WITHIN_DAYS = 7;

/**
 * Ada tagihan aktif di ruang ini (`hasBills` di kartu Tagihan 7 hari dan bagian `hasObligations`
 * kartu Aman). Dipanggil sekali per transaksi `loadBeranda`.
 */
async function hasActiveBillsTx(c: pg.PoolClient, ctx: LedgerCtx): Promise<boolean> {
  const { rows } = await c.query<{ any: boolean }>(
    `select exists (select 1 from app.bills b where b.space_id = $1 and b.archived_at is null)
              as any`,
    [ctx.spaceId],
  );
  return rows[0]?.any === true;
}

/** Ada anggaran wajib berlabel periode ini (`hasObligations` kartu Aman bila belum ada tagihan). */
async function hasWajibBudgetsTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  labelMonth: IsoDate,
): Promise<boolean> {
  const { rows } = await c.query<{ any: boolean }>(
    `select exists (select 1 from app.budgets b
                     where b.space_id = $1 and b.month = $2::date and b.wajib) as any`,
    [ctx.spaceId, labelMonth],
  );
  return rows[0]?.any === true;
}

async function billsCardTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  hasBills: boolean,
): Promise<BerandaBillsVM> {
  const items = await billsDueTx(c, ctx, { withinDays: BILLS_WITHIN_DAYS });
  return { items, hasBills };
}

async function budgetsCardTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  labelMonth: IsoDate,
): Promise<BerandaBudgetsVM> {
  const all = await budgetOverviewTx(c, ctx, labelMonth);
  const budgeted = all.filter((b) => b.budget !== null);
  const items = budgeted
    .filter((b) => b.pct !== null && b.pct >= NEAR_PCT)
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  return { items, hasBudgets: budgeted.length > 0 };
}

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
      const period = await payPeriodTx(c, ctx);
      const raw = await safeToSpendTx(c, ctx);
      const pace = await spendPaceTx(c, ctx);
      const hasBills = await hasActiveBillsTx(c, ctx);
      const hasObligations = hasBills || (await hasWajibBudgetsTx(c, ctx, period.labelMonth));
      const safe: SafeToSpendFullVM = {
        ...raw,
        ...amanStatus(raw, pace),
        hasObligations,
      };
      const today = await todayStatusTx(c, ctx);
      const accounts = given === undefined ? await listAccountsTx(c, ctx) : null;
      const expense = await hasExpenseTx(c, ctx);
      const recent = await recentEntriesTx(c, ctx, RECENT);
      const invite = ctx.kind === 'personal' ? await inviteOpenTx(c) : false;
      const bersama = ctx.kind === 'shared' ? await bersamaTx(c, ctx) : null;
      // Feed dan Kontribusi hanya untuk Bersama berisi ≥ 2 anggota (S8); koneksi yang sama.
      const extra =
        bersama && bersama.members >= 2
          ? await bersamaBerandaTx(c, ctx, {
              from: period.from,
              to: period.to,
              labelMonth: period.labelMonth,
            })
          : { partner: null, activity: null, contributions: null };
      const billsDue = await guarded(c, 'bills', () => billsCardTx(c, ctx, hasBills));
      const budgetsNear = await guarded(c, 'budgets', () =>
        budgetsCardTx(c, ctx, period.labelMonth),
      );
      return {
        period,
        safe,
        today,
        accounts,
        expense,
        recent,
        invite,
        bersama,
        extra,
        billsDue,
        budgetsNear,
      };
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
    period: read.period,
    safe: read.safe,
    today: read.today,
    hasOperasional,
    hasExpense: read.expense,
    recent: read.recent,
    invite: read.invite,
    bersama,
    billsDue: read.billsDue,
    budgetsNear: read.budgetsNear,
  };
}
