import 'server-only';
import type pg from 'pg';
import { z } from 'zod';
import type { NetWorthVM } from '@/features/ledger/types';
import { withLedger } from './retry';
import type { LedgerCtx } from './write';

/**
 * Kekayaan bersih satu ruang (S14 Task 9; `api.net_worth`, migrasi 0144). Satu fungsi SQL
 * (`app.net_worth_at`) dipakai Dompet dan snapshot: UI tidak menjumlah. Pribadi memuat piutang dan
 * utang (K5); Bersama selalu 0 di dua komponen itu. Ruang bukan milik pemanggil = DK404.
 */

// bigint dari pg = string; coerce + batas aman (ledger tidak sampai 2^53). Total boleh minus.
const money = z.coerce.number().int().max(Number.MAX_SAFE_INTEGER);
const nonNegative = money.min(0);

const netWorthRow = z.object({
  kas: money,
  aset: nonNegative,
  saham_pasar: nonNegative,
  saham_tanpa_harga: z.number().int().min(0),
  piutang: nonNegative,
  utang: nonNegative,
  total: money,
  price_as_of: z.iso.date().nullable(),
  month_ago_total: money.nullable(),
  month_ago_on: z.iso.date().nullable(),
});

export async function netWorthTx(c: pg.PoolClient, ctx: LedgerCtx): Promise<NetWorthVM> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select kas, aset, saham_pasar, saham_tanpa_harga, piutang, utang, total,
            price_as_of::text as price_as_of, month_ago_total, month_ago_on::text as month_ago_on
       from api.net_worth(p_space_id => $1)`,
    [ctx.spaceId],
  );
  const r = netWorthRow.parse(rows[0]);
  return {
    kas: r.kas,
    aset: r.aset,
    sahamPasar: r.saham_pasar,
    sahamTanpaHarga: r.saham_tanpa_harga,
    piutang: r.piutang,
    utang: r.utang,
    total: r.total,
    priceAsOf: r.price_as_of,
    monthAgoTotal: r.month_ago_total,
    monthAgoOn: r.month_ago_on,
  };
}

export async function loadKekayaan(ctx: LedgerCtx): Promise<NetWorthVM> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, (c) => netWorthTx(c, ctx));
}
