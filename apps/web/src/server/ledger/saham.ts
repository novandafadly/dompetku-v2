import 'server-only';
import type pg from 'pg';
import { z } from 'zod';
import type {
  SellPreviewVM,
  StockHoldingVM,
  StockOverviewVM,
  StockSide,
  StockTotalVM,
  StockTradeVM,
} from '@/features/saham/types';
import { withLedger } from './retry';
import { assertInSpace, callApi, NotInSpaceError, type LedgerCtx } from './write';

/**
 * Saham (S14 Task 10; API DB `0143_saham_api.sql`). Hanya Pribadi (DB menolak dompet saham di
 * Bersama). Pola `aset.ts`/`tujuan.ts`: Zod sebelum pool; hasil `jsonb`/baris divalidasi Zod di dalam
 * transaksi; dompet yang disebut lewat id wajib di ruang konteks (`assertInSpace`). Semua angka
 * (lembar, biaya rata-rata, nilai pasar, untung/rugi, pratinjau jual) dari SQL; tidak ada
 * penjumlahan, pembagian, atau log di sini. Kode saham dan harga tidak pernah masuk pesan galat.
 */

const id = z.uuid();
const ticker = z.string().regex(/^[A-Z]{4}$/);
const shares = z
  .number()
  .int()
  .min(1)
  .max(10 ** 13);
const price = z
  .number()
  .int()
  .min(1)
  .max(10 ** 9);
const fee = z
  .number()
  .int()
  .min(0)
  .max(10 ** 13);
const isoDate = z.iso.date();

export const buyStockSchema = z.object({
  clientId: id,
  accountId: id,
  ticker,
  shares,
  price,
  fee: fee.default(0),
  fromAccountId: id,
  on: isoDate.optional(),
  /** Dikirim sesudah server menolak `saldo_negatif` dan pengguna memilih lanjut. */
  allowNegative: z.boolean().default(false),
});

export const sellStockSchema = z.object({
  clientId: id,
  accountId: id,
  ticker,
  shares,
  price,
  fee: fee.default(0),
  tax: fee.default(0),
  toAccountId: id,
  on: isoDate.optional(),
});

/** Saham yang sudah dimiliki sebelum memakai DompetKu: tanpa efek kas. */
export const openHoldingSchema = z.object({
  clientId: id,
  accountId: id,
  ticker,
  shares,
  price,
  on: isoDate.optional(),
});

export const previewSellSchema = z.object({
  accountId: id,
  ticker,
  shares,
  price,
  fee: fee.default(0),
  tax: fee.default(0),
});

export const setPriceSchema = z.object({
  clientId: id,
  ticker,
  close: price,
  on: isoDate.optional(),
  confirmSpike: z.boolean().default(false),
});

/** Batal/pulihkan trade hidup terakhir satu kode (DB: `trade_not_latest` bila bukan). */
export const tradeActionSchema = z.object({
  clientId: id,
  tradeId: id,
  allowNegative: z.boolean().default(false),
});

// ===== Skema hasil =====
const buyResult = z.object({
  trade_id: z.uuid(),
  entry_id: z.uuid(),
  amount: z.number().int(),
});
const sellResult = z.object({
  trade_id: z.uuid(),
  entry_id: z.uuid(),
  proceeds: z.number().int(),
  cost_removed: z.number().int(),
  realized: z.number().int(),
});
const openResult = z.object({
  trade_id: z.uuid(),
  entry_id: z.uuid(),
  amount: z.number().int(),
});
const priceResult = z.object({ on_date: z.iso.date(), replaced: z.boolean() });
const tradeResult = z.object({ trade_id: z.uuid() });

const money = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const signed = z.coerce.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const side = z.enum(['buy', 'sell', 'opening']);

const overviewRow = z.object({
  // NULL hanya di baris total (selalu terakhir).
  holding_id: z.uuid().nullable(),
  ticker: z.string().nullable(),
  shares: money.nullable(),
  cost_total: money,
  avg_cost: money.nullable(),
  close: money.nullable(),
  close_on: z.iso.date().nullable(),
  // NULL bila belum ada harga (tidak ada yang bisa usang).
  stale: z.boolean().nullable(),
  held_pending: z.boolean(),
  held_on: z.iso.date().nullable(),
  market_value: money,
  unrealized: signed.nullable(),
  realized: signed,
  last_trade_id: z.uuid().nullable(),
  missing_price_count: z.number().int().min(0),
});
const tradeRow = z.object({
  id: z.uuid(),
  holding_id: z.uuid(),
  side,
  shares: money,
  price: money,
  occurred_on: z.iso.date(),
  counter_name: z.string().nullable(),
});

// Riwayat per kode yang dimuat di Detail dompet; yang lebih lama ada di riwayat dompet/Transaksi.
const TRADES_PER_HOLDING = 10;

/**
 * Posisi semua kode di satu dompet saham (`api.stock_overview`, INVOKER: RLS) + transaksi hidup
 * terbaru per kode. Dompet wajib di ruang konteks (Pribadi); selain itu DK404/`NotInSpaceError`.
 */
export async function stockOverviewTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  accountId: string,
): Promise<StockOverviewVM> {
  const acc = id.parse(accountId);
  await assertInSpace(c, 'accounts', [acc], ctx.spaceId);
  const { rows } = await c.query<Record<string, unknown>>(
    `select holding_id, ticker, shares, cost_total, avg_cost, close, close_on::text as close_on,
            stale, held_pending, held_on::text as held_on, market_value, unrealized, realized,
            last_trade_id, missing_price_count
       from api.stock_overview(p_account_id => $1)`,
    [acc],
  );
  const parsed = rows.map((r) => overviewRow.parse(r));
  const totalRow = parsed.at(-1);
  if (totalRow === undefined || totalRow.holding_id !== null) {
    throw new Error('stock_overview tanpa baris total');
  }
  const { rows: tradeRows } = await c.query<Record<string, unknown>>(
    `select x.id, x.holding_id, x.side, x.shares, x.price, x.occurred_on::text as occurred_on,
            cp.name as counter_name
       from (select t.id, t.holding_id, t.side, t.shares, t.price, t.occurred_on, t.seq,
                    row_number() over (partition by t.holding_id order by t.seq desc) as rn
               from app.stock_trades t
               join app.stock_holdings h on h.space_id = t.space_id and h.id = t.holding_id
              where h.account_id = $1 and t.space_id = $2 and t.voided_at is null) x
       -- Dompet lawan transfer trade (sumber beli / tujuan jual); saham berjalan tidak punya.
       left join lateral (
         select a.name
           from app.entries e
           join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id
           join app.accounts a on a.id = l.account_id
          where e.space_id = $2 and e.stock_trade_id = x.id and e.kind = 'transfer' and l.account_id <> $1
          limit 1
       ) cp on true
      where x.rn <= $3
      order by x.holding_id, x.seq desc`,
    [acc, ctx.spaceId, TRADES_PER_HOLDING],
  );
  const byHolding = new Map<string, StockTradeVM[]>();
  for (const raw of tradeRows) {
    const t = tradeRow.parse(raw);
    const list = byHolding.get(t.holding_id) ?? [];
    list.push({
      id: t.id,
      side: t.side as StockSide,
      shares: t.shares,
      price: t.price,
      occurredOn: t.occurred_on,
      counterName: t.counter_name,
    });
    byHolding.set(t.holding_id, list);
  }
  const holdings = parsed.slice(0, -1).map((r): StockHoldingVM => {
    if (r.holding_id === null || r.ticker === null || r.shares === null) {
      throw new Error('stock_overview baris kosong');
    }
    return {
      holdingId: r.holding_id,
      ticker: r.ticker,
      shares: r.shares,
      costTotal: r.cost_total,
      avgCost: r.avg_cost,
      close: r.close,
      closeOn: r.close_on,
      stale: r.stale === true,
      heldPending: r.held_pending,
      heldOn: r.held_on,
      marketValue: r.market_value,
      unrealized: r.unrealized,
      realized: r.realized,
      lastTradeId: r.last_trade_id,
      trades: byHolding.get(r.holding_id) ?? [],
    };
  });
  const total: StockTotalVM = {
    costTotal: totalRow.cost_total,
    marketValue: totalRow.market_value,
    unrealized: totalRow.unrealized,
    realized: totalRow.realized,
    stale: totalRow.stale === true,
    heldPending: totalRow.held_pending,
    missingPriceCount: totalRow.missing_price_count,
  };
  return { holdings, total };
}

export async function loadStockOverview(
  ctx: LedgerCtx,
  accountId: string,
): Promise<StockOverviewVM> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, (c) => stockOverviewTx(c, ctx, accountId));
}

/**
 * Pratinjau jual (`api.preview_sell`, DEFINER STABLE, tanpa tulis): rumus yang sama dengan
 * `sell_stock`. Dompet wajib di ruang konteks; kode yang tidak dipegang = DK404 `holding_not_found`.
 */
export async function previewSell(
  ctx: LedgerCtx,
  i: z.input<typeof previewSellSchema>,
): Promise<SellPreviewVM> {
  const v = previewSellSchema.parse(i);
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    await assertInSpace(c, 'accounts', [v.accountId], ctx.spaceId);
    const { rows } = await c.query<Record<string, unknown>>(
      `select cost_removed, proceeds, realized
         from api.preview_sell(p_account_id => $1, p_ticker => $2, p_shares => $3::bigint,
                               p_price => $4::bigint, p_fee => $5::bigint, p_tax => $6::bigint)`,
      [v.accountId, v.ticker, v.shares, v.price, v.fee, v.tax],
    );
    const r = z.object({ cost_removed: money, proceeds: signed, realized: signed }).parse(rows[0]);
    return { costRemoved: r.cost_removed, proceeds: r.proceeds, realized: r.realized };
  });
}

export interface BuyStockValue {
  tradeId: string;
  entryId: string;
  /** Total keluar dari dompet sumber (lembar x harga + biaya), dihitung DB. */
  amount: number;
}

/** `api.buy_stock`: transfer dompet sumber -> dompet saham; idempoten lewat `clientId`. */
export async function buyStock(
  ctx: LedgerCtx,
  i: z.input<typeof buyStockSchema>,
): Promise<BuyStockValue> {
  const v = buyStockSchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertInSpace(c, 'accounts', [v.accountId, v.fromAccountId], ctx.spaceId),
    `select api.buy_stock(
       p_client_id => $1, p_account_id => $2, p_ticker => $3, p_shares => $4::bigint,
       p_price => $5::bigint, p_fee => $6::bigint, p_from_account_id => $7, p_on => $8::date,
       p_allow_negative => $9) as r`,
    [
      v.clientId,
      v.accountId,
      v.ticker,
      v.shares,
      v.price,
      v.fee,
      v.fromAccountId,
      v.on ?? null,
      v.allowNegative,
    ],
    buyResult,
  );
  return { tradeId: r.trade_id, entryId: r.entry_id, amount: r.amount };
}

export interface SellStockValue {
  tradeId: string;
  entryId: string;
  /** Hasil bersih ke dompet tujuan, dan untung/rugi terealisasi (bertanda), dari DB. */
  proceeds: number;
  realized: number;
}

/** `api.sell_stock`: dua entri satu transaksi (untung/rugi + transfer ke dompet tujuan). */
export async function sellStock(
  ctx: LedgerCtx,
  i: z.input<typeof sellStockSchema>,
): Promise<SellStockValue> {
  const v = sellStockSchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertInSpace(c, 'accounts', [v.accountId, v.toAccountId], ctx.spaceId),
    `select api.sell_stock(
       p_client_id => $1, p_account_id => $2, p_ticker => $3, p_shares => $4::bigint,
       p_price => $5::bigint, p_fee => $6::bigint, p_tax => $7::bigint, p_to_account_id => $8,
       p_on => $9::date) as r`,
    [
      v.clientId,
      v.accountId,
      v.ticker,
      v.shares,
      v.price,
      v.fee,
      v.tax,
      v.toAccountId,
      v.on ?? null,
    ],
    sellResult,
  );
  return {
    tradeId: r.trade_id,
    entryId: r.entry_id,
    proceeds: r.proceeds,
    realized: r.realized,
  };
}

export interface OpenHoldingValue {
  tradeId: string;
  entryId: string;
  amount: number;
}

/** `api.open_stock_holding`: saham berjalan (`opening_balance`), tidak mengurangi dompet mana pun. */
export async function openStockHolding(
  ctx: LedgerCtx,
  i: z.input<typeof openHoldingSchema>,
): Promise<OpenHoldingValue> {
  const v = openHoldingSchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertInSpace(c, 'accounts', [v.accountId], ctx.spaceId),
    `select api.open_stock_holding(
       p_client_id => $1, p_account_id => $2, p_ticker => $3, p_shares => $4::bigint,
       p_price => $5::bigint, p_on => $6::date) as r`,
    [v.clientId, v.accountId, v.ticker, v.shares, v.price, v.on ?? null],
    openResult,
  );
  return { tradeId: r.trade_id, entryId: r.entry_id, amount: r.amount };
}

export interface SetPriceValue {
  onDate: string;
  replaced: boolean;
}

/**
 * `api.set_stock_price`: harga penutupan manual untuk ruang konteks (per ruang, jadi pasangan tidak
 * melihat kode yang dipegang). Lonjakan > 35% = `price_spike_unconfirmed` kecuali `confirmSpike`.
 */
export async function setStockPrice(
  ctx: LedgerCtx,
  i: z.input<typeof setPriceSchema>,
): Promise<SetPriceValue> {
  const v = setPriceSchema.parse(i);
  const r = await callApi(
    ctx,
    null,
    `select api.set_stock_price(
       p_client_id => $1, p_space_id => $2, p_ticker => $3, p_on => $4::date,
       p_close => $5::bigint, p_confirm_spike => $6) as r`,
    [v.clientId, ctx.spaceId, v.ticker, v.on ?? null, v.close, v.confirmSpike],
    priceResult,
  );
  return { onDate: r.on_date, replaced: r.replaced };
}

/** Trade wajib di ruang konteks (RLS: trade ruang lain/pasangan tidak terlihat = `NotInSpaceError`). */
async function assertTradeInSpace(c: pg.PoolClient, tradeId: string, spaceId: string) {
  const { rows } = await c.query<{ n: number }>(
    'select count(*)::int as n from app.stock_trades where id = $1 and space_id = $2',
    [tradeId, spaceId],
  );
  if (rows[0]?.n !== 1) throw new NotInSpaceError();
}

async function tradeAction(
  ctx: LedgerCtx,
  fn: 'void_stock_trade' | 'restore_stock_trade',
  i: z.input<typeof tradeActionSchema>,
): Promise<{ tradeId: string }> {
  const v = tradeActionSchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertTradeInSpace(c, v.tradeId, ctx.spaceId),
    `select api.${fn}(p_client_id => $1, p_trade_id => $2, p_allow_negative => $3) as r`,
    [v.clientId, v.tradeId, v.allowNegative],
    tradeResult,
  );
  return { tradeId: r.trade_id };
}

/** `api.void_stock_trade`: hanya transaksi hidup terakhir satu kode (selain itu `trade_not_latest`). */
export const voidStockTrade = (ctx: LedgerCtx, i: z.input<typeof tradeActionSchema>) =>
  tradeAction(ctx, 'void_stock_trade', i);

/** `api.restore_stock_trade`: pulihkan (Urungkan batal, Sampah); aturan terakhir sama. */
export const restoreStockTrade = (ctx: LedgerCtx, i: z.input<typeof tradeActionSchema>) =>
  tradeAction(ctx, 'restore_stock_trade', i);
