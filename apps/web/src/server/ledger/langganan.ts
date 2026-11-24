import 'server-only';
import type pg from 'pg';
import { z } from 'zod';
import type { SubscriptionSuggestionVM } from '@/features/rencana/types';
import { withLedger } from './retry';
import type { LedgerCtx } from './write';

/**
 * Deteksi langganan dan abaikan saran (S16 Task 4, K4–K5). Baca lewat `api.detect_subscriptions`
 * (INVOKER STABLE, hanya ruang ini, B13); tulis lewat `api.dismiss_subscription` (DEFINER, idempoten).
 */

const MAX_AMOUNT = 10_000_000_000_000;

const suggestionRowSchema = z.object({
  name: z.string(),
  amount: z.number().int(),
  months: z.number().int(),
  last_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  day_of_month: z.number().int().min(1).max(31),
  category_id: z.guid().nullable(),
  account_id: z.guid().nullable(),
});

export const dismissSubscriptionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  amount: z.number().int().min(1).max(MAX_AMOUNT),
});

export type DismissSubscriptionInput = z.infer<typeof dismissSubscriptionSchema>;

export async function detectSubscriptionsTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
): Promise<SubscriptionSuggestionVM[]> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select s.name, s.amount, s.months, to_char(s.last_on, 'YYYY-MM-DD') as last_on,
            s.day_of_month, s.category_id, s.account_id
       from api.detect_subscriptions(p_space_id => $1) s`,
    [ctx.spaceId],
  );
  return rows.map((raw) => {
    const r = suggestionRowSchema.parse(raw);
    return {
      name: r.name,
      amount: r.amount,
      months: r.months,
      lastOn: r.last_on,
      dayOfMonth: r.day_of_month,
      categoryId: r.category_id,
      accountId: r.account_id,
    };
  });
}

export async function dismissSubscription(
  ctx: LedgerCtx,
  input: DismissSubscriptionInput,
): Promise<{ dismissed: boolean }> {
  const v = dismissSubscriptionSchema.parse(input);
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<{ r: { dismissed?: boolean } }>(
      `select api.dismiss_subscription(p_space_id => $1, p_name => $2, p_amount => $3::bigint) as r`,
      [ctx.spaceId, v.name, v.amount],
    );
    return { dismissed: rows[0]?.r.dismissed === true };
  });
}
