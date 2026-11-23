import 'server-only';
import type pg from 'pg';
import { z } from 'zod';
import {
  TRIP_BATCH_MAX,
  TRIP_ENTRIES_MAX,
  type TripBreakdownRowVM,
  type TripBreakdownVM,
  type TripCandidateVM,
  type TripDetailData,
  type TripOverviewVM,
  type TripPhase,
  type TripVM,
} from '@/features/ledger/trip-types';
import { rosterTx } from './bersama';
import { tripEntriesTx } from './read';
import { withLedger } from './retry';
import { assertInSpace, callApi, NotInSpaceError, type LedgerCtx } from './write';

/**
 * Trip (S15, plan Task 6; API DB `0147_trip_api.sql` dan `0148_trip_entri.sql`). Pola `tujuan.ts`:
 * - Zod sebelum pool; hasil `jsonb`/baris divalidasi Zod di dalam transaksi (hasil asing = rollback);
 * - semua angka (total, rata-rata per hari, sisa, persen, rincian, kandidat) datang dari SQL dan
 *   hanya dipetakan ke view-model: tidak ada penjumlahan, pembagian, atau pengurangan uang di sini
 *   (I6; total trip = kelas `expense` Laporan dari satu sumber, `app.report_lines`);
 * - `api.create_trip` menerima `p_space_id` (anggota ruang terbukti `app.assert_member`); fungsi yang
 *   hanya menerima id trip dijaga DB (trip di luar ruang pemanggil tidak terlihat = DK404
 *   `trip_not_found`) dan dijaga lagi di sini: trip dan entri yang disebut lewat id wajib berada di
 *   ruang konteks (`assertInSpace`, `NotInSpaceError` = `not_found`), jadi trip Pribadi tidak
 *   tersentuh dari rute Bersama walaupun pengguna anggota kedua ruang (B25);
 * - nama trip hanya dikirim sebagai parameter dan dikembalikan sebagai data; tidak pernah masuk
 *   pesan galat atau log. Tidak ada log di sini.
 */

// ===== Skema input (diekspor untuk server action: satu sumber batas) =====
const id = z.uuid();
const name = z.string().trim().min(1).max(60);
// Batas sama dengan DB (0146): 2000-01-01..2100-12-31.
const isoDate = z.iso
  .date()
  .regex(/^(20\d{2}|2100)-/)
  .refine((d) => d <= '2100-12-31');
const budget = z
  .number()
  .int()
  .positive()
  .max(10 ** 13);

const DAY_MS = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/**
 * Selesai >= mulai dan rentang <= 366 hari (selisih <= 365). Galatnya menunjuk `endsOn`; DB tetap
 * penjaga akhir (`invalid_argument` kolom `ends_on`). Tanpa rentang yang rusak di bentuk Zod
 * (tanggal sendiri tidak valid) pemeriksaan ini dilewati: isu kolom itu sudah dilaporkan.
 */
function rangeOk(v: { startsOn: string; endsOn: string }): boolean {
  const d = days(v.startsOn, v.endsOn);
  return d >= 0 && d <= 365;
}
const RANGE_MSG = { path: ['endsOn'], message: 'range' };

export const createTripSchema = z
  .object({
    clientId: id,
    name,
    startsOn: isoDate,
    endsOn: isoDate,
    budget: budget.nullable().optional(),
  })
  .refine(rangeOk, RANGE_MSG);

/** Ganti-penuh (nama, tanggal, anggaran; `budget: null` = hapus anggaran); trip terarsip = `trip_archived`. */
export const updateTripSchema = z
  .object({
    tripId: id,
    name,
    startsOn: isoDate,
    endsOn: isoDate,
    budget: budget.nullable(),
  })
  .refine(rangeOk, RANGE_MSG);

/** Arsipkan, pulihkan: idempoten alami di DB (tanpa `clientId`). */
export const tripIdSchema = z.object({ tripId: id });

/**
 * Tandai atau lepas banyak pengeluaran sekaligus (atomik di DB): `tripId: null` = lepas. 1..100 id
 * unik; satu id yang tidak layak menggagalkan seluruh panggilan.
 */
export const setEntriesTripSchema = z.object({
  clientId: id,
  tripId: id.nullable(),
  entryIds: z
    .array(id)
    .min(1)
    .max(TRIP_BATCH_MAX)
    .refine((a) => new Set(a).size === a.length),
});

// ===== Skema hasil =====
const createResult = z.object({ trip_id: z.uuid(), replayed: z.boolean() });
const statusResult = z.object({ trip_id: z.uuid(), status: z.enum(['active', 'archived']) });
const setEntriesResult = z.object({ changed: z.number().int().min(0), replayed: z.boolean() });

// bigint dari pg = number aman (parser `server/db.ts`); Zod menolak yang di luar rentang aman.
const money = z.coerce.number().int().max(Number.MAX_SAFE_INTEGER);
const phase = z.enum(['upcoming', 'ongoing', 'ended']);

const tripRow = z.object({
  trip_id: z.guid(),
  name: z.string(),
  starts_on: z.iso.date(),
  ends_on: z.iso.date(),
  budget_amount: money.positive().nullable(),
  archived: z.boolean(),
  day_count: z.number().int().min(1),
  spent: money.min(0),
  entry_count: z.number().int().min(0),
  budget_left: money.nullable(),
  phase,
});

const overviewRow = z.object({
  trip_id: z.guid(),
  name: z.string(),
  starts_on: z.iso.date(),
  ends_on: z.iso.date(),
  budget_amount: money.positive().nullable(),
  archived: z.boolean(),
  phase,
  day_count: z.number().int().min(1),
  elapsed_days: z.number().int().min(0),
  spent: money.min(0),
  entry_count: z.number().int().min(0),
  per_day: money.min(0).nullable(),
  budget_left: money.nullable(),
  pct: money.min(0).nullable(),
  first_entry_on: z.iso.date().nullable(),
  last_entry_on: z.iso.date().nullable(),
});

const breakdownRow = z.object({
  dim: z.enum(['category', 'day', 'member']),
  key: z.string(),
  label: z.string().nullable(),
  amount: money,
  entry_count: z.number().int().min(0),
});

const candidateRow = z.object({
  entry_id: z.guid(),
  occurred_on: z.iso.date(),
  description: z.string().nullable(),
  category_name: z.string().nullable(),
  account_name: z.string(),
  amount: money.positive(),
});

// ===== Baca =====
function toTripVM(raw: Record<string, unknown>): TripVM {
  const r = tripRow.parse(raw);
  return {
    id: r.trip_id,
    name: r.name,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    budget: r.budget_amount,
    archived: r.archived,
    phase: r.phase satisfies TripPhase,
    dayCount: r.day_count,
    spent: r.spent,
    entryCount: r.entry_count,
    budgetLeft: r.budget_left,
  };
}

/** `api.list_trips` (urutan SQL: aktif dulu, mulai terbaru; lalu arsip; maks 200 trip per ruang). */
export async function listTripsTx(c: pg.PoolClient, ctx: LedgerCtx): Promise<TripVM[]> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select t.trip_id, t.name, t.starts_on, t.ends_on, t.budget_amount,
            t.archived_at is not null as archived, t.day_count, t.spent, t.entry_count,
            t.budget_left, t.phase
       from api.list_trips(p_space_id => $1) with ordinality as t (
              trip_id, name, starts_on, ends_on, budget_amount, archived_at, day_count, spent,
              entry_count, budget_left, phase, n)
      order by t.n`,
    [ctx.spaceId],
  );
  return rows.map(toTripVM);
}

/** Daftar Trip (S15-TR2): satu transaksi. */
export async function loadTrips(ctx: LedgerCtx): Promise<TripVM[]> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, (c) => listTripsTx(c, ctx));
}

async function overviewTx(c: pg.PoolClient, tripId: string): Promise<TripOverviewVM> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select o.trip_id, o.name, o.starts_on, o.ends_on, o.budget_amount,
            o.archived_at is not null as archived, o.phase, o.day_count, o.elapsed_days, o.spent,
            o.entry_count, o.per_day, o.budget_left, o.pct, o.first_entry_on, o.last_entry_on
       from api.trip_overview(p_trip_id => $1) o`,
    [tripId],
  );
  const r = overviewRow.parse(rows[0]);
  return {
    id: r.trip_id,
    name: r.name,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    budget: r.budget_amount,
    archived: r.archived,
    phase: r.phase,
    dayCount: r.day_count,
    elapsedDays: r.elapsed_days,
    spent: r.spent,
    entryCount: r.entry_count,
    perDay: r.per_day,
    budgetLeft: r.budget_left,
    pct: r.pct,
    firstEntryOn: r.first_entry_on,
    lastEntryOn: r.last_entry_on,
  };
}

async function breakdownTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  tripId: string,
): Promise<TripBreakdownVM> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select b.dim, b.key, b.label, b.amount, b.entry_count
       from api.trip_breakdown(p_trip_id => $1) with ordinality as b (
              dim, key, label, amount, entry_count, n)
      order by b.n`,
    [tripId],
  );
  const out: TripBreakdownVM = { category: [], day: [], member: [] };
  for (const raw of rows) {
    const r = breakdownRow.parse(raw);
    const row: TripBreakdownRowVM = {
      key: r.key,
      label: r.label,
      amount: r.amount,
      entryCount: r.entry_count,
      ...(r.dim === 'member' && r.key === ctx.userId ? { isMe: true as const } : {}),
    };
    out[r.dim].push(row);
  }
  return out;
}

/**
 * `api.trip_candidates` (pengeluaran biasa tanpa trip dalam rentang tanggal trip; trip terarsip =
 * kosong). Meminta `TRIP_BATCH_MAX + 1` baris sebagai penanda "masih ada" (satu perbandingan, bukan
 * hitungan).
 */
async function candidatesTx(
  c: pg.PoolClient,
  tripId: string,
): Promise<{ candidates: TripCandidateVM[]; more: boolean }> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select k.entry_id, k.occurred_on, k.description, k.category_name, k.account_name, k.amount
       from api.trip_candidates(p_trip_id => $1, p_limit => $2) with ordinality as k (
              entry_id, occurred_on, description, category_name, account_name, amount, n)
      order by k.n`,
    [tripId, TRIP_BATCH_MAX + 1],
  );
  const all = rows.map((raw): TripCandidateVM => {
    const r = candidateRow.parse(raw);
    return {
      entryId: r.entry_id,
      occurredOn: r.occurred_on,
      description: r.description,
      categoryName: r.category_name,
      accountName: r.account_name,
      amount: r.amount,
    };
  });
  return { candidates: all.slice(0, TRIP_BATCH_MAX), more: all.length > TRIP_BATCH_MAX };
}

/**
 * Detail satu trip (S15-TR5..TR9): ringkasan, rincian, kandidat `Masukkan`, daftar pengeluaran
 * (maks `TRIP_ENTRIES_MAX`) dan banyak anggota, dalam SATU transaksi. `null` = id bukan uuid, trip
 * tidak ada, atau milik ruang lain (disamakan: 404 seragam, tanpa orakel nama).
 */
export async function loadTripDetail(
  ctx: LedgerCtx,
  tripId: string,
): Promise<TripDetailData | null> {
  if (!id.safeParse(tripId).success) return null;
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    try {
      await assertInSpace(c, 'trips', [tripId], ctx.spaceId);
    } catch (e) {
      if (e instanceof NotInSpaceError) return null;
      throw e;
    }
    const trip = await overviewTx(c, tripId);
    const breakdown = await breakdownTx(c, ctx, tripId);
    const { candidates, more } = await candidatesTx(c, tripId);
    const { entries, truncated } = await tripEntriesTx(c, ctx, tripId, TRIP_ENTRIES_MAX);
    const memberCount = (await rosterTx(c, ctx)).length;
    return {
      trip,
      breakdown,
      candidates,
      candidatesMore: more,
      entries,
      entriesTruncated: truncated,
      memberCount,
    };
  });
}

// ===== Tulis =====
export interface CreateTripValue {
  tripId: string;
  replayed: boolean;
}

/** `api.create_trip`: idempoten lewat `clientId`; nama aktif kembar = `name_taken`; > 200 trip = `trip_limit`. */
export async function createTrip(
  ctx: LedgerCtx,
  i: z.input<typeof createTripSchema>,
): Promise<CreateTripValue> {
  const v = createTripSchema.parse(i);
  const r = await callApi(
    ctx,
    null,
    `select api.create_trip(
       p_client_id => $1, p_space_id => $2, p_name => $3, p_starts_on => $4::date,
       p_ends_on => $5::date, p_budget_amount => $6::bigint) as r`,
    [v.clientId, ctx.spaceId, v.name, v.startsOn, v.endsOn, v.budget ?? null],
    createResult,
  );
  return { tripId: r.trip_id, replayed: r.replayed };
}

/** Trip wajib di ruang konteks (selain RLS dan DB): trip Pribadi tidak tersentuh dari rute Bersama. */
const tripInSpace = (tripId: string, spaceId: string) => (c: pg.PoolClient) =>
  assertInSpace(c, 'trips', [tripId], spaceId);

/** `api.update_trip` (ganti-penuh); trip terarsip = `trip_archived`. */
export async function updateTrip(
  ctx: LedgerCtx,
  i: z.input<typeof updateTripSchema>,
): Promise<{ tripId: string }> {
  const v = updateTripSchema.parse(i);
  const r = await callApi(
    ctx,
    tripInSpace(v.tripId, ctx.spaceId),
    `select api.update_trip(
       p_trip_id => $1, p_name => $2, p_starts_on => $3::date, p_ends_on => $4::date,
       p_budget_amount => $5::bigint) as r`,
    [v.tripId, v.name, v.startsOn, v.endsOn, v.budget],
    statusResult,
  );
  return { tripId: r.trip_id };
}

// Nama fungsi tetap per aksi (tanpa interpolasi dari input).
const STATUS_SQL = {
  archive: 'select api.archive_trip(p_trip_id => $1) as r',
  restore: 'select api.restore_trip(p_trip_id => $1) as r',
} as const;

async function setArchived(
  ctx: LedgerCtx,
  i: z.input<typeof tripIdSchema>,
  op: keyof typeof STATUS_SQL,
): Promise<{ tripId: string; archived: boolean }> {
  const v = tripIdSchema.parse(i);
  const r = await callApi(
    ctx,
    tripInSpace(v.tripId, ctx.spaceId),
    STATUS_SQL[op],
    [v.tripId],
    statusResult,
  );
  return { tripId: r.trip_id, archived: r.status === 'archived' };
}

/** `api.archive_trip` (idempoten): hilang dari pilihan Catat; pengeluaran tetap tercatat. */
export const archiveTrip = (ctx: LedgerCtx, i: z.input<typeof tripIdSchema>) =>
  setArchived(ctx, i, 'archive');

/** `api.restore_trip` (idempoten); nama aktif yang sama dibuat sesudahnya = `name_taken`. */
export const restoreTrip = (ctx: LedgerCtx, i: z.input<typeof tripIdSchema>) =>
  setArchived(ctx, i, 'restore');

/**
 * `api.set_entries_trip`: tandai (`tripId`) atau lepas (`null`) 1..100 pengeluaran, atomik. Trip dan
 * semua entri wajib di ruang konteks (ruang lain = `not_found`). Hasil: banyak entri yang benar-benar
 * berubah (0 = sudah sesuai; replay = nilai yang sama dengan `replayed: true`).
 */
export async function setEntriesTrip(
  ctx: LedgerCtx,
  i: z.input<typeof setEntriesTripSchema>,
): Promise<{ changed: number; replayed: boolean }> {
  const v = setEntriesTripSchema.parse(i);
  const r = await callApi(
    ctx,
    async (c) => {
      if (v.tripId !== null) await assertInSpace(c, 'trips', [v.tripId], ctx.spaceId);
      await assertInSpace(c, 'entries', v.entryIds, ctx.spaceId);
    },
    `select api.set_entries_trip(
       p_client_id => $1, p_trip_id => $2::uuid, p_entry_ids => $3::uuid[]) as r`,
    [v.clientId, v.tripId, v.entryIds],
    setEntriesResult,
  );
  return { changed: r.changed, replayed: r.replayed };
}
