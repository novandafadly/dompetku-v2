import 'server-only';
import type pg from 'pg';
import { z } from 'zod';
import type {
  CreateSplitResultVM,
  PatunganData,
  PatunganWalletsVM,
  PendingSettlementVM,
  SettleResultVM,
  SplitBalanceVM,
  SplitContextVM,
  SplitCursor,
  SplitEffectVM,
  SplitHistoryItemVM,
  SplitPayerAccountVM,
} from '@/features/patungan/types';
import { partnerOf, rosterTx } from './bersama';
import { withLedger } from './retry';
import { SpaceNotFoundError } from './space';
import { callApi, type LedgerCtx } from './write';

/**
 * Bagi tagihan Bersama / patungan (S12 Task 7; API DB `0136_patungan_api.sql`). Pola `utang.ts`:
 * - Zod sebelum pool; hasil `jsonb` divalidasi Zod di dalam transaksi (hasil asing = rollback);
 * - semua angka dari SQL (saldo antar-anggota, bagian, sisa, efek): tidak ada penjumlahan di sini;
 * - fungsi tulis menerima `p_space_id` = ruang Bersama konteks; dompet Pribadi pembayar/penerima
 *   TIDAK diperiksa lewat `assertInSpace` (ruangnya Pribadi, bukan konteks): DB yang menolak dompet
 *   yang tidak terlihat (`account_not_found`) atau bukan operasional/tabungan (`split_account_invalid`),
 *   tanpa nama atau nominal;
 * - baris tagihan/pelunasan yang disebut lewat id dikunci DB ke pemanggil (bukan pembayar/pelunas =
 *   DK404), jadi tidak ada cek ruang tambahan; id dari ruang lain tidak pernah ditemukan.
 * Pribadi tidak punya fitur ini: `api.*` menolak ruang bukan Bersama (`split_shared_only`) dan
 * wrapper bacaan melempar `SpaceNotFoundError` (404) bila ruang konteks bukan Bersama.
 * Tidak ada log di sini.
 */

/**
 * Patungan hanya di Bersama: dilempar action SEBELUM menyentuh DB bila ruang argumen Pribadi.
 * Bentuk galat domain (`DK422`) agar `toLedgerError` memetakannya seperti penolakan DB.
 */
export class SplitSharedOnlyError extends Error {
  readonly code = 'DK422';
  constructor() {
    super('split_shared_only');
    this.name = 'SplitSharedOnlyError';
  }
}

// ===== Skema input (diekspor untuk server action: satu sumber batas) =====
const id = z.uuid();
const amount = z
  .number()
  .int()
  .positive()
  .max(10 ** 13);
const isoDate = z.iso.date().regex(/^20\d{2}-/);
const description = z.string().trim().max(200);

export const createSplitSchema = z.object({
  clientId: id,
  accountId: id,
  amount,
  categoryId: id,
  occurredOn: isoDate.optional(),
  description: description.optional(),
  /** Bagian per anggota (Σ = nominal); tidak ada = sama rata (sisa ganjil ke pembayar, SQL). */
  shares: z
    .array(
      z.strictObject({
        userId: id,
        amount: z
          .number()
          .int()
          .min(0)
          .max(10 ** 13),
      }),
    )
    .min(1)
    .max(2)
    .optional(),
  allowNegative: z.boolean().optional(),
});

export const splitActionSchema = z.object({
  clientId: id,
  splitId: id,
  allowNegative: z.boolean().optional(),
});

export const settleSplitSchema = z.object({
  clientId: id,
  accountId: id,
  amount,
  occurredOn: isoDate.optional(),
  allowNegative: z.boolean().optional(),
});

export const settlementActionSchema = z.object({
  clientId: id,
  settlementId: id,
  allowNegative: z.boolean().optional(),
});

export const receiveSettlementSchema = z.object({
  clientId: id,
  settlementId: id,
  accountId: id,
  occurredOn: isoDate.optional(),
});

// ===== Skema hasil =====
const money = z.number().int();
const share = z.object({ user_id: z.guid(), amount: money.min(0) });
const effect = z.object({ account_id: z.guid(), account_name: z.string(), amount: money });
const createSplitResult = z.object({
  split_id: z.guid(),
  expense_entry_id: z.guid(),
  in_entry_id: z.guid(),
  out_entry_id: z.guid(),
  amount: money.positive(),
  shares: z.array(share),
  version: z.number().int(),
  warnings: z.array(z.string()),
  replayed: z.boolean(),
});
const voidSplitResult = z.object({
  split_id: z.guid(),
  affected: z.array(z.guid()),
  effects: z.array(effect),
  warnings: z.array(z.string()),
  replayed: z.boolean(),
});
const settleResult = z.object({
  settlement_id: z.guid(),
  out_entry_id: z.guid(),
  in_entry_id: z.guid(),
  amount: money.positive(),
  to_user: z.guid(),
  remaining: money.min(0),
  warnings: z.array(z.string()),
  replayed: z.boolean(),
});
const voidSettlementResult = z.object({
  settlement_id: z.guid(),
  affected: z.array(z.guid()),
  effects: z.array(effect),
  warnings: z.array(z.string()),
  replayed: z.boolean(),
});
const receiveResult = z.object({
  settlement_id: z.guid(),
  in_entry_id: z.guid(),
  out_entry_id: z.guid(),
  amount: money.positive(),
  warnings: z.array(z.string()),
  replayed: z.boolean(),
});

const balanceResult = z.object({
  members: z.array(z.object({ user_id: z.guid(), balance: money })),
  debtor_id: z.guid().nullable(),
  creditor_id: z.guid().nullable(),
  amount: money.min(0).nullable(),
  split_count: z.number().int().min(0),
  settlement_count: z.number().int().min(0),
  pending: z.array(
    z.object({
      settlement_id: z.guid(),
      from_user: z.guid(),
      to_user: z.guid(),
      amount: money.positive(),
      occurred_on: z.iso.date(),
    }),
  ),
});

// ===== Kursor riwayat =====
const CURSOR_AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CURSOR_MAX = 120;

/** Komponen tanggal/jam benar-benar ada (bukan 30 Feb, 25.00); tahun 1970–9999. */
function validInstant(at: string): boolean {
  const m = CURSOR_AT.exec(at);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (y < 1970) return false;
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === mo - 1 &&
    t.getUTCDate() === d &&
    t.getUTCHours() === h &&
    t.getUTCMinutes() === mi &&
    t.getUTCSeconds() === s
  );
}

export function encodeSplitCursor(c: SplitCursor): string {
  return Buffer.from(`${c.on}|${c.at}|${c.id}`, 'utf8').toString('base64url');
}

const cursorParts = z.tuple([
  z.iso.date().regex(/^20\d{2}-/),
  z.string().refine(validInstant),
  z.string().regex(UUID),
]);

/** `?sebelum=` → kursor; apa pun yang tidak sah = `null` (halaman pertama), tidak pernah 404/500. */
export function parseSplitCursor(sp: string | string[] | undefined): SplitCursor | null {
  if (typeof sp !== 'string' || sp.length === 0 || sp.length > CURSOR_MAX) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(sp)) return null;
  const parsed = cursorParts.safeParse(Buffer.from(sp, 'base64url').toString('utf8').split('|'));
  if (!parsed.success) return null;
  const [on, at, cid] = parsed.data;
  const cursor = { on, at, id: cid };
  return encodeSplitCursor(cursor) === sp ? cursor : null;
}

// ===== Baca =====
/** Konteks Catat Bersama: penonton + anggota lain; `null` bila ruang bukan Bersama atau belum dua anggota. */
export async function splitContextTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
): Promise<SplitContextVM | null> {
  const { rows } = await c.query<{ kind: string }>(
    'select s.kind::text as kind from app.spaces s where s.id = $1',
    [ctx.spaceId],
  );
  if (rows[0]?.kind !== 'shared') return null;
  const roster = await rosterTx(c, ctx);
  const me = roster.find((m) => m.id === ctx.userId);
  const other = roster.length === 2 ? roster.find((m) => m.id !== ctx.userId) : undefined;
  if (me === undefined || other === undefined) return null;
  return {
    me: { id: me.id, name: me.name, initial: me.initial },
    partner: { id: other.id, name: other.name, initial: other.initial },
  };
}

/**
 * `api.shared_balances` + nama anggota. `null` = Bersama bukan dua anggota (tanpa kartu/halaman
 * berarti). Arah utang dan nominal dari SQL apa adanya (tidak dihitung ulang).
 */
export async function sharedBalanceTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
): Promise<SplitBalanceVM | null> {
  const people = await splitContextTx(c, ctx);
  if (people === null) return null;
  const { rows } = await c.query<{ r: unknown }>(
    'select api.shared_balances(p_space_id => $1) as r',
    [ctx.spaceId],
  );
  const r = balanceResult.parse(rows[0]?.r);
  const pending: PendingSettlementVM[] = r.pending.map((p) => ({
    id: p.settlement_id,
    fromId: p.from_user,
    toId: p.to_user,
    amount: p.amount,
    occurredOn: p.occurred_on,
  }));
  return {
    me: people.me,
    partner: people.partner,
    debtorId: r.debtor_id,
    creditorId: r.creditor_id,
    amount: r.amount,
    splitCount: r.split_count,
    settlementCount: r.settlement_count,
    pending,
  };
}

const historyRow = z.object({
  item: z.enum(['split', 'settlement']),
  id: z.guid(),
  occurred_on: z.iso.date(),
  created_at_wib: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/),
  cursor_at: z.string().refine(validInstant),
  actor_id: z.guid(),
  counterparty_id: z.guid().nullable(),
  // bigint dari pg = string; Zod mengubahnya, nilai di atas 2^53 ditolak (ledger tidak sampai sana).
  amount: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  description: z.string().nullable(),
  category_id: z.guid().nullable(),
  expense_entry_id: z.guid().nullable(),
  shares: z.array(share).nullable(),
  received: z.boolean().nullable(),
  voided_at_wib: z.string().nullable(),
  purge_after_wib: z.string().nullable(),
});

export const PATUNGAN_PAGE = 20;

/**
 * Satu halaman `api.split_history` (tagihan + pelunasan berbaur, terbaru di atas) dipecah ke
 * `history` (hidup) dan `deleted` (milik penonton, ≤ 90 hari). Kategori dari ruang Bersama.
 */
export async function splitHistoryTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  opts: { before?: SplitCursor | null | undefined; limit?: number },
): Promise<Pick<PatunganData, 'history' | 'deleted' | 'next'>> {
  const limit = z
    .number()
    .int()
    .min(1)
    .max(99)
    .parse(opts.limit ?? PATUNGAN_PAGE);
  const before = opts.before ?? null;
  const wib = (col: string) =>
    `to_char(${col} at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI:SS"+07:00"')`;
  const { rows } = await c.query<Record<string, unknown>>(
    `select h.item, h.id, h.occurred_on, ${wib('h.created_at')} as created_at_wib,
            to_char(h.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at,
            h.actor_id, h.counterparty_id, h.amount, h.description, h.category_id,
            h.expense_entry_id, h.shares, h.received,
            ${wib('h.voided_at')} as voided_at_wib, ${wib('h.purge_after')} as purge_after_wib
       from api.split_history(p_space_id => $1, p_limit => $2::int, p_before_on => $3::date,
                              p_before_at => $4::timestamptz, p_before_id => $5::uuid) h
      order by h.occurred_on desc, h.created_at desc, h.id desc`,
    [ctx.spaceId, limit + 1, before?.on ?? null, before?.at ?? null, before?.id ?? null],
  );
  const page = rows.slice(0, limit).map((r) => historyRow.parse(r));
  const last = page.at(-1);
  const next: SplitCursor | null =
    rows.length > limit && last !== undefined
      ? { on: last.occurred_on, at: last.cursor_at, id: last.id }
      : null;

  const catIds = [...new Set(page.map((r) => r.category_id).filter((x) => x !== null))];
  const cats = new Map<string, { name: string; icon: string }>();
  if (catIds.length > 0) {
    const res = await c.query<{ id: string; name: string; icon: string }>(
      'select id, name, icon from app.categories where space_id = $1 and id = any($2::uuid[])',
      [ctx.spaceId, catIds],
    );
    for (const k of res.rows) cats.set(k.id, { name: k.name, icon: k.icon });
  }

  const history: SplitHistoryItemVM[] = [];
  const deleted: SplitHistoryItemVM[] = [];
  for (const r of page) {
    const common = {
      id: r.id,
      occurredOn: r.occurred_on,
      createdAt: r.created_at_wib,
      amount: r.amount,
      voidedAt: r.voided_at_wib,
      purgeAfter: r.purge_after_wib,
    };
    let item: SplitHistoryItemVM;
    if (r.item === 'split') {
      if (r.expense_entry_id === null) throw new Error('split_history tanpa entri pengeluaran');
      const cat = r.category_id === null ? undefined : cats.get(r.category_id);
      item = {
        ...common,
        item: 'split',
        payerId: r.actor_id,
        description: r.description,
        categoryName: cat?.name ?? null,
        categoryIcon: cat?.icon ?? null,
        expenseEntryId: r.expense_entry_id,
        shares: (r.shares ?? []).map((s) => ({ userId: s.user_id, amount: s.amount })),
      };
    } else {
      if (r.counterparty_id === null) throw new Error('split_history pelunasan tanpa penerima');
      item = {
        ...common,
        item: 'settlement',
        fromId: r.actor_id,
        toId: r.counterparty_id,
        received: r.received === true,
      };
    }
    (r.voided_at_wib === null ? history : deleted).push(item);
  }
  return { history, deleted, next };
}

/** Halaman `/bersama/patungan`: saldo + riwayat dalam satu `withLedger`; Pribadi = 404. */
export async function loadPatungan(
  ctx: LedgerCtx & { kind: 'personal' | 'shared' },
  opts: { before?: SplitCursor | null | undefined } = {},
): Promise<PatunganData> {
  if (ctx.kind !== 'shared') throw new SpaceNotFoundError();
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const balance = await sharedBalanceTx(c, ctx);
    if (balance === null) return { balance: null, history: [], deleted: [], next: null };
    return { balance, ...(await splitHistoryTx(c, ctx, { before: opts.before })) };
  });
}

/** Anggota lain Bersama untuk salinan kosong; `null` = solo. */
export async function patunganPartnerTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
): Promise<{ name: string; initial: string } | null> {
  return partnerOf(await rosterTx(c, ctx), ctx.userId);
}

const walletRow = z.object({
  id: z.guid(),
  name: z.string(),
  pocket: z.enum(['operasional', 'tabungan']),
  balance: z.coerce.number().int().max(Number.MAX_SAFE_INTEGER),
});
const linkedRow = z.object({
  item_id: z.guid(),
  name: z.string(),
  balance: z.coerce.number().int().max(Number.MAX_SAFE_INTEGER),
});

/**
 * Dompet Pribadi penonton untuk sheet Lunasi/Terima (operasional/tabungan aktif, urut daftar) dan
 * dompet yang tersentuh baris patungan miliknya (dialog akibat). Dibaca di bawah RLS pemanggil:
 * hanya dompet miliknya yang terlihat. Rute Bersama saja (Pribadi = 404); nama dompet tidak pernah
 * lewat props halaman, hanya hasil action ini (R27).
 */
export async function loadPatunganWallets(
  ctx: LedgerCtx & { kind: 'personal' | 'shared' },
): Promise<PatunganWalletsVM> {
  if (ctx.kind !== 'shared') throw new SpaceNotFoundError();
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const w = await c.query<Record<string, unknown>>(
      `select a.id, a.name, a.pocket::text as pocket, b.balance
         from app.accounts a
         join app.account_balances b on b.space_id = a.space_id and b.account_id = a.id
        where a.space_kind = 'personal' and a.archived_at is null
          and a.pocket in ('operasional', 'tabungan')
        order by a.sort_order, a.created_at, a.id`,
    );
    const accounts: SplitPayerAccountVM[] = w.rows.map((r) => walletRow.parse(r));
    // Kaki Pribadi dicari lewat `link_id` kaki Bersama (milik penonton: RLS menyembunyikan lainnya).
    const l = await c.query<Record<string, unknown>>(
      `select x.item_id, a.name, b.balance
         from (
           select s.id as item_id, ie.link_id
             from app.splits s
             join app.entries ie on ie.space_id = s.space_id and ie.id = s.in_entry_id
            where s.space_id = $1 and s.payer_id = app.current_user_id()
           union all
           select t.id, ie.link_id
             from app.settlements t
             join app.entries ie on ie.space_id = t.space_id and ie.id = t.in_entry_id
            where t.space_id = $1 and t.from_user = app.current_user_id()
           union all
           select t.id, re.link_id
             from app.settlements t
             join app.entries re on re.space_id = t.space_id and re.id = t.received_entry_id
            where t.space_id = $1 and t.to_user = app.current_user_id()
         ) x
         join app.entries pe on pe.link_id = x.link_id and pe.space_kind = 'personal'
         join app.entry_lines pl on pl.space_id = pe.space_id and pl.entry_id = pe.id
                                and pl.role = 'main'
         join app.accounts a on a.space_id = pl.space_id and a.id = pl.account_id
         join app.account_balances b on b.space_id = a.space_id and b.account_id = a.id`,
      [ctx.spaceId],
    );
    const linked: PatunganWalletsVM['linked'] = {};
    for (const raw of l.rows) {
      const r = linkedRow.parse(raw);
      linked[r.item_id] = { name: r.name, balance: r.balance };
    }
    return { accounts, linked };
  });
}

// ===== Tulis =====
function effectsOf(rows: z.output<typeof effect>[]): SplitEffectVM[] {
  return rows.map((e) => ({ accountName: e.account_name, amount: e.amount }));
}

/** `api.create_split` (K3): satu tagihan Bersama dibayar dari dompet Pribadi pemanggil. */
export async function createSplit(
  ctx: LedgerCtx,
  i: z.input<typeof createSplitSchema>,
): Promise<CreateSplitResultVM> {
  const v = createSplitSchema.parse(i);
  const r = await callApi(
    ctx,
    null,
    `select api.create_split(
       p_client_id => $1, p_space_id => $2, p_account_id => $3, p_amount => $4::bigint,
       p_category_id => $5, p_occurred_on => $6::date, p_description => $7,
       p_shares => $8::jsonb, p_allow_negative => $9) as r`,
    [
      v.clientId,
      ctx.spaceId,
      v.accountId,
      v.amount,
      v.categoryId,
      v.occurredOn ?? null,
      v.description ?? null,
      v.shares === undefined
        ? null
        : JSON.stringify(v.shares.map((s) => ({ user_id: s.userId, amount: s.amount }))),
      v.allowNegative ?? false,
    ],
    createSplitResult,
  );
  return {
    splitId: r.split_id,
    expenseEntryId: r.expense_entry_id,
    amount: r.amount,
    shares: r.shares.map((s) => ({ userId: s.user_id, amount: s.amount })),
    replayed: r.replayed,
  };
}

export interface VoidSplitValue {
  splitId: string;
  effects: SplitEffectVM[];
  replayed: boolean;
}

/** `api.void_split` (AK1): hanya pembayar; ketiga entri + bagian dibatalkan atomik. */
export async function voidSplit(
  ctx: LedgerCtx,
  i: z.input<typeof splitActionSchema>,
): Promise<VoidSplitValue> {
  const v = splitActionSchema.parse(i);
  const r = await callApi(
    ctx,
    null,
    'select api.void_split(p_client_id => $1, p_split_id => $2) as r',
    [v.clientId, v.splitId],
    voidSplitResult,
  );
  return { splitId: r.split_id, effects: effectsOf(r.effects), replayed: r.replayed };
}

/** `api.restore_split`: pulihkan tagihan yang dihapus (90 hari); saldo dompet pembayar dijaga. */
export async function restoreSplit(
  ctx: LedgerCtx,
  i: z.input<typeof splitActionSchema>,
): Promise<VoidSplitValue> {
  const v = splitActionSchema.parse(i);
  const r = await callApi(
    ctx,
    null,
    `select api.restore_split(p_client_id => $1, p_split_id => $2, p_allow_negative => $3) as r`,
    [v.clientId, v.splitId, v.allowNegative ?? false],
    voidSplitResult,
  );
  return { splitId: r.split_id, effects: effectsOf(r.effects), replayed: r.replayed };
}

/** `api.settle_split` (PT3): pelunas = pemanggil, penerima = anggota lain (SQL). */
export async function settleSplit(
  ctx: LedgerCtx,
  i: z.input<typeof settleSplitSchema>,
): Promise<SettleResultVM> {
  const v = settleSplitSchema.parse(i);
  const r = await callApi(
    ctx,
    null,
    `select api.settle_split(
       p_client_id => $1, p_space_id => $2, p_account_id => $3, p_amount => $4::bigint,
       p_occurred_on => $5::date, p_allow_negative => $6) as r`,
    [
      v.clientId,
      ctx.spaceId,
      v.accountId,
      v.amount,
      v.occurredOn ?? null,
      v.allowNegative ?? false,
    ],
    settleResult,
  );
  return {
    settlementId: r.settlement_id,
    amount: r.amount,
    remaining: r.remaining,
    replayed: r.replayed,
  };
}

/** `api.void_settlement` (AK2 pelunas): ditolak `settlement_received` bila sudah diterima. */
export async function voidSettlement(
  ctx: LedgerCtx,
  i: z.input<typeof settlementActionSchema>,
): Promise<VoidSplitValue & { settlementId: string }> {
  const v = settlementActionSchema.parse(i);
  const r = await callApi(
    ctx,
    null,
    'select api.void_settlement(p_client_id => $1, p_settlement_id => $2) as r',
    [v.clientId, v.settlementId],
    voidSettlementResult,
  );
  return {
    splitId: r.settlement_id,
    settlementId: r.settlement_id,
    effects: effectsOf(r.effects),
    replayed: r.replayed,
  };
}

/** `api.receive_settlement` (PT4): penerima memindahkan uang pelunasan ke dompet Pribadinya. */
export async function receiveSettlement(
  ctx: LedgerCtx,
  i: z.input<typeof receiveSettlementSchema>,
): Promise<{ settlementId: string; amount: number; replayed: boolean }> {
  const v = receiveSettlementSchema.parse(i);
  const r = await callApi(
    ctx,
    null,
    `select api.receive_settlement(
       p_client_id => $1, p_settlement_id => $2, p_account_id => $3, p_occurred_on => $4::date) as r`,
    [v.clientId, v.settlementId, v.accountId, v.occurredOn ?? null],
    receiveResult,
  );
  return { settlementId: r.settlement_id, amount: r.amount, replayed: r.replayed };
}

/** `api.void_receipt` (AK2 penerima): uang kembali menunggu di Bersama; saldo patungan tetap. */
export async function voidReceipt(
  ctx: LedgerCtx,
  i: z.input<typeof settlementActionSchema>,
): Promise<VoidSplitValue & { settlementId: string }> {
  const v = settlementActionSchema.parse(i);
  const r = await callApi(
    ctx,
    null,
    `select api.void_receipt(
       p_client_id => $1, p_settlement_id => $2, p_allow_negative => $3) as r`,
    [v.clientId, v.settlementId, v.allowNegative ?? false],
    voidSettlementResult,
  );
  return {
    splitId: r.settlement_id,
    settlementId: r.settlement_id,
    effects: effectsOf(r.effects),
    replayed: r.replayed,
  };
}
