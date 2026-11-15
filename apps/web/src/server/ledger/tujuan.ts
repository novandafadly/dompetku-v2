import 'server-only';
import type pg from 'pg';
import { z } from 'zod';
import type { GoalData, GoalStatus, GoalVM } from '@/features/tujuan/types';
import { rosterTx } from './bersama';
import { withLedger } from './retry';
import { assertInSpace, callApi, NotInSpaceError, type LedgerCtx } from './write';

/**
 * Tujuan tabungan (S13, plan Task 4; API DB `0138_tujuan_api.sql`). Pola `utang.ts`:
 * - Zod sebelum pool; hasil `jsonb`/baris divalidasi Zod di dalam transaksi (hasil asing = rollback);
 * - `loadTujuan` satu `withLedger` (hanya saat segmen Tujuan dibuka, terpisah dari `loadRencana`);
 * - `api.create_goal` menerima `p_space_id` (anggota ruang terbukti `app.assert_member`); fungsi yang
 *   hanya menerima id tujuan (`update/complete/archive/restore_goal`) dijaga DB: tujuan di luar
 *   ruang pemanggil tidak terlihat (RLS) = DK404 `goal_not_found` seragam. Dompet pada
 *   `create_goal` wajib di ruang konteks (cek `assertInSpace` sebelum DB; ruang lain = `not_found`);
 * - uang = bilangan bulat rupiah dari SQL (bigint dibaca string lalu dikonversi), tanpa
 *   penjumlahan atau persen di sini. Tidak ada log di sini.
 */

// ===== Skema input (diekspor untuk server action: satu sumber batas) =====
const id = z.uuid();
const target = z
  .number()
  .int()
  .positive()
  .max(10 ** 13);
const name = z.string().trim().min(1).max(60);
const isoDate = z.iso.date().regex(/^20\d{2}-/);

export const createGoalSchema = z.object({
  clientId: id,
  accountId: id,
  name,
  target,
  targetOn: isoDate.optional(),
});

/** `targetOn: null` = hapus tanggal (K7); dompet tidak bisa diganti. */
export const updateGoalSchema = z.object({
  goalId: id,
  name,
  target,
  targetOn: isoDate.nullable(),
});

/** Selesaikan, arsipkan, pulihkan: idempoten alami di DB (tanpa `clientId`). */
export const goalIdSchema = z.object({ goalId: id });

// ===== Skema hasil =====
const status = z.enum(['active', 'completed', 'archived']);
const createResult = z.object({
  goal_id: z.uuid(),
  status: z.literal('active'),
  replayed: z.boolean(),
});
const statusResult = z.object({ goal_id: z.uuid(), status });

// bigint dari pg = string; Zod mengubahnya, nilai di atas 2^53 ditolak (ledger tidak sampai sana).
const money = z.coerce.number().int().max(Number.MAX_SAFE_INTEGER);
const goalRow = z.object({
  goal_id: z.guid(),
  name: z.string(),
  account_id: z.guid(),
  account_name: z.string(),
  account_archived: z.boolean(),
  status,
  target_amount: money.positive(),
  target_on: z.iso.date().nullable(),
  completed_on: z.iso.date().nullable(),
  archived_on: z.iso.date().nullable(),
  created_by: z.guid(),
  balance: money,
  saved: money.min(0),
  remaining: money.min(0),
  pct: z.number().int().min(0).max(100),
  reached: z.boolean(),
  periods_left: z.number().int().min(1).nullable(),
  per_period: money.min(0).nullable(),
  account_has_other_active: z.boolean(),
});

// ===== Baca =====
/**
 * `api.list_goals` (urutan SQL: aktif tercapai, tanggal terdekat, tanpa tanggal; lalu selesai/arsip
 * terbaru) + nama pembuat dan anggota lain (hanya Bersama dua anggota; Pribadi/solo = `null`).
 */
export async function listGoalsTx(c: pg.PoolClient, ctx: LedgerCtx): Promise<GoalData> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select g.goal_id, g.name, g.account_id, g.account_name, g.account_archived, g.status,
            g.target_amount, g.target_on,
            (g.completed_at at time zone 'Asia/Jakarta')::date::text as completed_on,
            (g.archived_at at time zone 'Asia/Jakarta')::date::text as archived_on,
            g.created_by, g.balance, g.saved, g.remaining, g.pct, g.reached, g.periods_left,
            g.per_period, g.account_has_other_active
       from api.list_goals(p_space_id => $1) with ordinality as g (
              goal_id, name, account_id, account_name, account_archived, status, target_amount,
              target_on, completed_at, archived_at, created_by, created_at, balance, saved,
              remaining, pct, reached, periods_left, per_period, account_has_other_active, n)
      order by g.n`,
    [ctx.spaceId],
  );
  const roster = await rosterTx(c, ctx);
  const two = roster.length === 2;
  const byId = new Map(roster.map((m) => [m.id, m.name]));
  const other = two ? roster.find((m) => m.id !== ctx.userId) : undefined;
  const goals = rows.map((raw): GoalVM => {
    const r = goalRow.parse(raw);
    return {
      goalId: r.goal_id,
      name: r.name,
      accountId: r.account_id,
      accountName: r.account_name,
      accountArchived: r.account_archived,
      status: r.status,
      target: r.target_amount,
      targetOn: r.target_on,
      completedOn: r.completed_on,
      archivedOn: r.archived_on,
      createdByName: two ? (byId.get(r.created_by) ?? null) : null,
      balance: r.balance,
      saved: r.saved,
      remaining: r.remaining,
      pct: r.pct,
      reached: r.reached,
      periodsLeft: r.periods_left,
      perPeriod: r.per_period,
      accountHasOtherActive: r.account_has_other_active,
    };
  });
  return { goals, partnerName: other?.name ?? null };
}

/** Segmen Tujuan di Rencana (S13-TJ1/TJ2): satu transaksi, terpisah dari `loadRencana`. */
export async function loadTujuan(ctx: LedgerCtx): Promise<GoalData> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, (c) => listGoalsTx(c, ctx));
}

// ===== Tulis =====
export interface CreateGoalValue {
  goalId: string;
  replayed: boolean;
}

/** Tujuan wajib di ruang konteks: tujuan Pribadi tidak tersentuh dari rute Bersama (dan sebaliknya). */
async function assertGoalInSpace(c: pg.PoolClient, goalId: string, spaceId: string): Promise<void> {
  const { rows } = await c.query<{ n: number }>(
    'select count(*)::int as n from app.goals where id = $1 and space_id = $2',
    [goalId, spaceId],
  );
  if (rows[0]?.n !== 1) throw new NotInSpaceError();
}

/** `api.create_goal`: idempoten lewat `clientId`; tujuan kedua pada dompet sama = `goal_exists`. */
export async function createGoal(
  ctx: LedgerCtx,
  i: z.input<typeof createGoalSchema>,
): Promise<CreateGoalValue> {
  const v = createGoalSchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertInSpace(c, 'accounts', [v.accountId], ctx.spaceId),
    `select api.create_goal(
       p_client_id => $1, p_space_id => $2, p_account_id => $3, p_name => $4,
       p_target_amount => $5::bigint, p_target_on => $6::date) as r`,
    [v.clientId, ctx.spaceId, v.accountId, v.name, v.target, v.targetOn ?? null],
    createResult,
  );
  return { goalId: r.goal_id, replayed: r.replayed };
}

/** `api.update_goal` (K7): nama, target, tanggal (`null` = hapus); dompet tidak bisa diganti. */
export async function updateGoal(
  ctx: LedgerCtx,
  i: z.input<typeof updateGoalSchema>,
): Promise<{ goalId: string }> {
  const v = updateGoalSchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertGoalInSpace(c, v.goalId, ctx.spaceId),
    `select api.update_goal(
       p_goal_id => $1, p_name => $2, p_target_amount => $3::bigint, p_target_on => $4::date) as r`,
    [v.goalId, v.name, v.target, v.targetOn],
    statusResult,
  );
  return { goalId: r.goal_id };
}

// Nama fungsi tetap per aksi (tanpa interpolasi dari input).
const STATUS_SQL = {
  complete: 'select api.complete_goal(p_goal_id => $1) as r',
  archive: 'select api.archive_goal(p_goal_id => $1) as r',
  restore: 'select api.restore_goal(p_goal_id => $1) as r',
} as const;

async function setStatus(
  ctx: LedgerCtx,
  i: z.input<typeof goalIdSchema>,
  op: keyof typeof STATUS_SQL,
): Promise<{ goalId: string; status: GoalStatus }> {
  const v = goalIdSchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertGoalInSpace(c, v.goalId, ctx.spaceId),
    STATUS_SQL[op],
    [v.goalId],
    statusResult,
  );
  return { goalId: r.goal_id, status: r.status };
}

/** `api.complete_goal` (K4): hanya dari aktif dan tercapai (`goal_not_reached`). */
export const completeGoal = (ctx: LedgerCtx, i: z.input<typeof goalIdSchema>) =>
  setStatus(ctx, i, 'complete');

/** `api.archive_goal`: aktif/selesai ke arsip (idempoten). */
export const archiveGoal = (ctx: LedgerCtx, i: z.input<typeof goalIdSchema>) =>
  setStatus(ctx, i, 'archive');

/** `api.restore_goal`: selesai/arsip kembali aktif (`goal_exists`/`account_archived` bila tidak bisa). */
export const restoreGoal = (ctx: LedgerCtx, i: z.input<typeof goalIdSchema>) =>
  setStatus(ctx, i, 'restore');
