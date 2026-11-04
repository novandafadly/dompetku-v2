import 'server-only';
import type pg from 'pg';
import { z } from 'zod';
import type { IsoDate, Rupiah } from '@dompetku/domain';
import type { ReimbursableVM } from '@/features/ledger/types';
import { withLedger } from './retry';
import { assertInSpace, callApi, type LedgerCtx } from './write';

/**
 * Talangan kantor dan reimburse (S7, BSD §2.2 butir 1): wrapper `api.create_reimbursement` dan
 * `api.open_reimbursables`, pola yang sama dengan `write.ts` (Zod sebelum pool, satu
 * `withLedger`, hasil `jsonb` divalidasi Zod). Talangan dan dompet tujuan wajib berada di ruang
 * konteks (DK404 bila tidak). Tidak ada log di sini.
 */

const id = z.uuid();

export const createReimbursementSchema = z.object({
  clientId: id,
  entryId: id,
  accountId: id,
  amount: z
    .number()
    .int()
    .positive()
    .max(10 ** 13),
  occurredOn: z.iso.date().optional(),
  description: z.string().trim().max(200).optional(),
});

const reimbursementResult = z.object({
  entry_id: z.uuid(),
  version: z.number().int(),
  replayed: z.boolean(),
  warnings: z.array(z.string()),
  remaining: z.number().int().min(0),
});

export interface CreateReimbursementInput {
  clientId: string;
  /** Talangan (pengeluaran Pribadi reimbursable) yang diganti. */
  entryId: string;
  /** Dompet penerima reimburse, di ruang talangan. */
  accountId: string;
  amount: Rupiah;
  occurredOn?: IsoDate | undefined;
  description?: string | undefined;
}

/**
 * Catat reimburse (boleh sebagian). `remaining` = sisa sesudah reimburse ini SAAT PERTAMA dicatat:
 * pada replay (`replayed: true`) nilainya tidak diperbarui, jadi pemanggil yang butuh sisa terkini
 * membaca ulang `openReimbursables`.
 */
export async function createReimbursement(
  ctx: LedgerCtx,
  i: CreateReimbursementInput,
): Promise<{ entryId: string; remaining: number; replayed: boolean }> {
  const v = createReimbursementSchema.parse(i);
  const r = await callApi(
    ctx,
    async (c) => {
      await assertInSpace(c, 'entries', [v.entryId], ctx.spaceId);
      await assertInSpace(c, 'accounts', [v.accountId], ctx.spaceId);
    },
    `select api.create_reimbursement(
       p_client_id => $1, p_entry_id => $2, p_account_id => $3, p_amount => $4::bigint,
       p_occurred_on => $5::date, p_description => $6) as r`,
    [v.clientId, v.entryId, v.accountId, v.amount, v.occurredOn ?? null, v.description ?? null],
    reimbursementResult,
  );
  return { entryId: r.entry_id, remaining: r.remaining, replayed: r.replayed };
}

interface ReimbursableRow {
  entry_id: string;
  occurred_on: string;
  description: string | null;
  category_name: string | null;
  account_id: string;
  amount: number;
  reimbursed: number;
  remaining: number;
}

/** Talangan hidup ruang ini yang sisanya > 0, urut tanggal lalu id (`api.open_reimbursables`). */
export async function openReimbursablesTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
): Promise<ReimbursableVM[]> {
  const { rows } = await c.query<ReimbursableRow>(
    `select o.entry_id, o.occurred_on, o.description, cat.name as category_name, o.account_id,
            o.amount, o.reimbursed, o.remaining
       from api.open_reimbursables(p_space_id => $1) with ordinality as o (
              entry_id, occurred_on, description, account_id, amount, reimbursed, remaining, n)
       left join app.entries e on e.space_id = $1 and e.id = o.entry_id
       left join app.categories cat on cat.space_id = e.space_id and cat.id = e.category_id
      order by o.n`,
    [ctx.spaceId],
  );
  return rows.map((r) => ({
    entryId: r.entry_id,
    occurredOn: r.occurred_on,
    description: r.description,
    categoryName: r.category_name,
    accountId: r.account_id,
    amount: r.amount,
    reimbursed: r.reimbursed,
    remaining: r.remaining,
  }));
}

export async function openReimbursables(ctx: LedgerCtx): Promise<ReimbursableVM[]> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, (c) => openReimbursablesTx(c, ctx));
}
