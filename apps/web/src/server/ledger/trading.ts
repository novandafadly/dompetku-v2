import 'server-only';
import type pg from 'pg';
import { z } from 'zod';
import type {
  TradingAccountVM,
  TradingFiguresVM,
  TradingOverviewVM,
} from '@/features/ledger/types';
import { withLedger } from './retry';
import type { LedgerCtx } from './write';

/**
 * Modal trading (S12 Task 5; `api.trading_overview`, migrasi 0134). Hanya Pribadi: Bersama = DK422
 * `pocket_personal_only`, ruang bukan milik pemanggil = DK404. Semua angka dari SQL (modal disetor,
 * ditarik, sisa, hasil, `Kurang`); UI tidak menjumlah. Setor/tarik modal = `createTransfer` biasa.
 */

// bigint dari pg = string; coerce + batas aman (ledger tidak sampai 2^53).
const money = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const overviewRow = z.object({
  // NULL hanya di baris total (selalu terakhir).
  account_id: z.guid().nullable(),
  name: z.string().nullable(),
  balance: z.coerce.number().int().max(Number.MAX_SAFE_INTEGER),
  capital_in: money,
  capital_out: money,
  capital_left: money,
  realized: money,
  shortfall: money,
  has_deposit: z.boolean(),
});

function figures(r: z.output<typeof overviewRow>): TradingFiguresVM {
  return {
    balance: r.balance,
    capitalIn: r.capital_in,
    capitalOut: r.capital_out,
    capitalLeft: r.capital_left,
    realized: r.realized,
    shortfall: r.shortfall,
    hasDeposit: r.has_deposit,
  };
}

/** Satu baris per dompet trading aktif (urut daftar), lalu satu baris total (selalu ada). */
export async function tradingOverviewTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
): Promise<TradingOverviewVM> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select account_id, name, balance, capital_in, capital_out, capital_left, realized, shortfall,
            has_deposit
       from api.trading_overview(p_space_id => $1)`,
    [ctx.spaceId],
  );
  const parsed = rows.map((r) => overviewRow.parse(r));
  const totalRow = parsed.at(-1);
  if (totalRow?.account_id !== null) throw new Error('trading_overview tanpa baris total');
  const accounts = parsed.slice(0, -1).map((r): TradingAccountVM => {
    if (r.account_id === null || r.name === null) throw new Error('trading_overview baris kosong');
    return { id: r.account_id, name: r.name, ...figures(r) };
  });
  return { accounts, total: figures(totalRow) };
}

export async function loadTrading(ctx: LedgerCtx): Promise<TradingOverviewVM> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, (c) => tradingOverviewTx(c, ctx));
}
