import 'server-only';
import type pg from 'pg';
import { z } from 'zod';
import type { AssetKind, AssetOverviewVM } from '@/features/ledger/types';
import { withLedger } from './retry';
import { assertInSpace, callApi, type LedgerCtx } from './write';

/**
 * Aset non-saham (S14 Task 9; API DB `0141_aset_api.sql`, `0143_saham_api.sql`). Pola `tujuan.ts`:
 * Zod sebelum pool; hasil `jsonb`/baris divalidasi Zod di dalam transaksi; dompet yang disebut lewat
 * id wajib di ruang konteks (`assertInSpace`). Aset = dompet ber-pocket `aset` (K3): saldo buku =
 * nilai; selisih `Perbarui nilai` dihitung DB (entri `valuation`, bukan pemasukan/pengeluaran).
 * Uang = bilangan bulat rupiah dari SQL; tidak ada penjumlahan atau log di sini.
 */

const id = z.uuid();
const ASSET_KINDS = [
  'emas',
  'properti',
  'kendaraan',
  'reksa_dana',
  'deposito',
  'saham',
  'lainnya',
] as const satisfies readonly AssetKind[];
const assetKind = z.enum(ASSET_KINDS);
const value = z
  .number()
  .int()
  .min(0)
  .max(10 ** 13);
const isoDate = z.iso.date();

export const createAssetSchema = z.object({
  clientId: id,
  // Batas sama dengan `api.create_account` (60 untuk aset; dompet biasa 40).
  name: z.string().trim().min(1).max(60),
  assetKind,
  /** Nilai sekarang; 0 = tanpa entri Nilai awal. Jenis saham wajib 0 (DB: `opening_balance`). */
  openingBalance: value.default(0),
  /** Tanggal nilai awal; kosong = hari ini (WIB server). */
  openedOn: isoDate.optional(),
});

export const revalueAssetSchema = z.object({
  clientId: id,
  accountId: id,
  /** Nilai sekarang; selisih dengan saldo dihitung DB. */
  value,
  on: isoDate.optional(),
});

const createResult = z.object({ account_id: z.uuid() });
const revalueResult = z.object({
  entry_id: z.uuid().nullable(),
  version: z.number().int(),
  // jsonb bigint = angka; nilai di atas 2^53 tidak mungkin (batas 10^13).
  delta: z.number().int(),
  unchanged: z.boolean(),
});

const money = z.coerce.number().int().max(Number.MAX_SAFE_INTEGER);
const overviewRow = z.object({
  account_id: z.guid(),
  name: z.string(),
  asset_kind: assetKind,
  balance: money,
  last_valued_on: z.iso.date().nullable(),
  last_change: money.nullable(),
  market_value: money.nullable(),
  missing_price_count: z.number().int().min(0).nullable(),
});

/** `api.asset_overview`: satu baris per dompet aset aktif ruang ini (urut daftar). */
export async function assetOverviewTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
): Promise<AssetOverviewVM[]> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select account_id, name, asset_kind, balance, last_valued_on::text as last_valued_on,
            last_change, market_value, missing_price_count
       from api.asset_overview(p_space_id => $1)`,
    [ctx.spaceId],
  );
  return rows.map((raw) => {
    const r = overviewRow.parse(raw);
    return {
      accountId: r.account_id,
      name: r.name,
      assetKind: r.asset_kind,
      balance: r.balance,
      lastValuedOn: r.last_valued_on,
      lastChange: r.last_change,
      marketValue: r.market_value,
      missingPriceCount: r.missing_price_count,
    };
  });
}

export async function loadAsetOverview(ctx: LedgerCtx): Promise<AssetOverviewVM[]> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, (c) => assetOverviewTx(c, ctx));
}

export interface CreateAssetValue {
  accountId: string;
}

/** `api.create_account` pocket `aset` (jenis wajib); idempoten lewat `clientId`. */
export async function createAsset(
  ctx: LedgerCtx,
  i: z.input<typeof createAssetSchema>,
): Promise<CreateAssetValue> {
  const v = createAssetSchema.parse(i);
  const r = await callApi(
    ctx,
    null,
    `select api.create_account(
       p_client_id => $1, p_space_id => $2, p_name => $3, p_pocket => 'aset'::app.pocket,
       p_wallet_type => 'cash'::app.wallet_type, p_opened_on => $4::date,
       p_opening_balance => $5::bigint, p_asset_kind => $6) as r`,
    [v.clientId, ctx.spaceId, v.name, v.openedOn ?? null, v.openingBalance, v.assetKind],
    createResult,
  );
  return { accountId: r.account_id };
}

export interface RevalueAssetValue {
  /** Entri `valuation`; `null` bila nilainya sudah sama (tidak ada yang dicatat). */
  entryId: string | null;
  version: number;
  /** Nilai baru − saldo tercatat (bertanda), dari DB. */
  delta: number;
  unchanged: boolean;
}

/** `api.revalue_asset`: terima nilai sekarang, DB menghitung selisih; selisih 0 = tanpa entri. */
export async function revalueAsset(
  ctx: LedgerCtx,
  i: z.input<typeof revalueAssetSchema>,
): Promise<RevalueAssetValue> {
  const v = revalueAssetSchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertInSpace(c, 'accounts', [v.accountId], ctx.spaceId),
    `select api.revalue_asset(
       p_client_id => $1, p_account_id => $2, p_value => $3::bigint, p_on => $4::date) as r`,
    [v.clientId, v.accountId, v.value, v.on ?? null],
    revalueResult,
  );
  return { entryId: r.entry_id, version: r.version, delta: r.delta, unchanged: r.unchanged };
}
