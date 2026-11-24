import 'server-only';
import type { IsoDate } from '@dompetku/domain';
import type pg from 'pg';
import { z } from 'zod';
import { withUser, type Pools } from '@/server/db';

/**
 * Pembantu kuota harian AI per pengguna per hari WIB (`0150_ai_kuota.sql`).
 * - `api.ai_quota` = baca sisa kuota (INVOKER STABLE).
 * - `api.consume_ai_quota` = potongan atomik kuota (DEFINER, anti balapan paralel, returns jsonb).
 */

export type AiFeature = 'parse' | 'analysis';

export interface AiQuotaStatus {
  feature: AiFeature;
  used: number;
  limit: number;
  remaining: number;
  day: IsoDate;
}

export interface AiQuotaConsumeResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  day: IsoDate;
}

export interface AiUserCtx {
  pools: Pools;
  userId: string;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const featureSchema = z.enum(['parse', 'analysis']);

const quotaRowSchema = z.object({
  feature: featureSchema,
  used: z.number().int().min(0),
  daily_limit: z.number().int().min(1),
  remaining: z.number().int().min(0),
  day: isoDate,
});

const consumeJsonSchema = z.object({
  allowed: z.boolean(),
  feature: featureSchema,
  used: z.number().int().min(0),
  limit: z.number().int().min(1),
  remaining: z.number().int().min(0),
  day: isoDate,
});

export async function getAiQuotaTx(
  c: pg.PoolClient,
  feature?: AiFeature,
): Promise<AiQuotaStatus[]> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select feature, used, daily_limit, remaining,
            to_char(day, 'YYYY-MM-DD') as day
       from api.ai_quota($1::text)
      order by feature`,
    [feature ?? null],
  );
  return rows.map((r) => {
    const p = quotaRowSchema.parse(r);
    return {
      feature: p.feature,
      used: p.used,
      limit: p.daily_limit,
      remaining: p.remaining,
      day: p.day,
    };
  });
}

export async function getAiQuota(ctx: AiUserCtx, feature?: AiFeature): Promise<AiQuotaStatus[]> {
  if (feature !== undefined) featureSchema.parse(feature);
  return withUser(ctx.pools.app, ctx.userId, (c) => getAiQuotaTx(c, feature));
}

export async function consumeAiQuotaTx(
  c: pg.PoolClient,
  feature: AiFeature,
): Promise<AiQuotaConsumeResult> {
  featureSchema.parse(feature);
  const { rows } = await c.query<{ res: unknown }>(`select api.consume_ai_quota($1::text) as res`, [
    feature,
  ]);
  const parsed = consumeJsonSchema.parse(rows[0]?.res);
  return {
    allowed: parsed.allowed,
    used: parsed.used,
    limit: parsed.limit,
    remaining: parsed.remaining,
    day: parsed.day,
  };
}

export async function consumeAiQuota(
  ctx: AiUserCtx,
  feature: AiFeature,
): Promise<AiQuotaConsumeResult> {
  featureSchema.parse(feature);
  return withUser(ctx.pools.app, ctx.userId, (c) => consumeAiQuotaTx(c, feature));
}
