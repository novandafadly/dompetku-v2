import 'server-only';
import type pg from 'pg';
import { z } from 'zod';
import type { IsoDate, Rupiah } from '@dompetku/domain';
import type { Pocket, WalletType } from '@/features/ledger/types';
import type { Pools } from '../db';
import { withLedger } from './retry';

/**
 * Wrapper tulis `api.*` (BSD §9.1, §9.2). Setiap fungsi:
 * 1. memvalidasi input dengan Zod sebelum menyentuh pool (ZodError dilempar mentah; pesan Zod
 *    hanya memuat batas, bukan nilai input);
 * 2. menjalankan satu transaksi `withLedger(pools, userId, spaceId)` (konteks user, cek anggota,
 *    ulang 40001/40P01) dan memanggil `api.f(p_x => $n)` dengan parameter bernama;
 * 3. memvalidasi hasil `jsonb` dengan Zod di dalam transaksi, jadi hasil yang tidak dikenali
 *    di-rollback.
 * Galat DB dan Zod dilempar mentah; pemetaan ke `ActionResult` ada di server action
 * (`toLedgerError`). Tidak ada log di sini.
 *
 * Ruang eksplisit: baris yang disebut lewat id (dompet, entri, kategori) wajib berada di
 * `ctx.spaceId`, termasuk untuk fungsi yang tidak menerima `p_space_id` (ubah/batal/pulihkan
 * entri, ubah/arsip kategori). Bila tidak, `NotInSpaceError` (DK404 → `not_found`): dompet atau
 * entri Pribadi tidak bisa dipakai dari rute Bersama walaupun user anggota kedua ruang.
 * Fungsi antar ruang (transfer antar ruang, pindah ruang) menerima `toSpaceId` (uuid yang sudah
 * di-resolve server dari slug ruang, bukan dari klien): baris ruang tujuan wajib berada di
 * `toSpaceId`, dan `toSpaceId` ≠ `ctx.spaceId` (Zod).
 */

export interface LedgerCtx {
  pools: Pools;
  userId: string;
  spaceId: string;
}

/** Id yang dikirim tidak ada di ruang konteks (disamakan dengan DK404 tidak ditemukan). */
export class NotInSpaceError extends Error {
  readonly code = 'DK404';
  constructor() {
    super('not_in_space');
    this.name = 'NotInSpaceError';
  }
}

// ===== Skema input (diekspor untuk validasi server action: satu sumber batas) =====
const id = z.uuid();
const amount = z
  .number()
  .int()
  .positive()
  .max(10 ** 13);
const isoDate = z.iso.date();
const description = z.string().trim().max(200);
const categoryName = z.string().trim().min(1).max(40);
const icon = z.string().regex(/^[A-Z][A-Za-z0-9]{0,39}$/);
const version = z.number().int().min(1).max(2_147_483_647);

export const createEntrySchema = z.object({
  clientId: id,
  accountId: id,
  kind: z.enum(['income', 'expense']),
  amount,
  categoryId: id,
  occurredOn: isoDate.optional(),
  description: description.optional(),
  /** Talangan kantor: hanya pengeluaran Pribadi (DB: `reimbursable_personal_expense_only`). */
  reimbursable: z.boolean().optional(),
  allowNegative: z.boolean().optional(),
});

/** Biaya transfer (admin bank), 0 = tanpa biaya; batas sama dengan `p_fee` di DB. */
const fee = z
  .number()
  .int()
  .min(0)
  .max(10 ** 13);

export const createTransferSchema = z
  .object({
    clientId: id,
    fromAccountId: id,
    toAccountId: id,
    amount,
    fee: fee.optional(),
    occurredOn: isoDate.optional(),
    description: description.optional(),
    allowNegative: z.boolean().optional(),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, { path: ['toAccountId'] });

export const updateEntrySchema = z.object({
  clientId: id,
  entryId: id,
  expectedVersion: version,
  accountId: id,
  amount,
  categoryId: id.nullable(),
  occurredOn: isoDate.nullable(),
  description: description.nullable(),
  reimbursable: z.boolean(),
  allowNegative: z.boolean().optional(),
});

/** Transfer antar ruang (S7): ruang tujuan eksplisit dan berbeda dari ruang konteks. */
export const createSpaceTransferSchema = z.object({
  clientId: id,
  fromAccountId: id,
  toSpaceId: id,
  toAccountId: id,
  amount,
  fee,
  occurredOn: isoDate.optional(),
  description: description.optional(),
  sharedNote: description.optional(),
  allowNegative: z.boolean(),
});

export const moveEntrySchema = z.object({
  clientId: id,
  entryId: id,
  expectedVersion: version,
  toSpaceId: id,
  accountId: id,
  categoryId: id,
  keepDescription: z.boolean().optional(),
  allowNegative: z.boolean().optional(),
});

export const reconcileBalanceSchema = z.object({
  clientId: id,
  accountId: id,
  /** Saldo nyata; boleh negatif (batas `p_target_balance` di DB). */
  actualBalance: z
    .number()
    .int()
    .min(-(10 ** 13))
    .max(10 ** 13),
});

export const archiveAccountSchema = z.object({ accountId: id });

export const voidEntrySchema = z.object({
  clientId: id,
  entryId: id,
  expectedVersion: version,
  allowNegative: z.boolean().optional(),
});

export const restoreEntrySchema = voidEntrySchema;

export const createAccountSchema = z.object({
  clientId: id,
  name: z.string().trim().min(1).max(40),
  pocket: z.enum(['operasional', 'tabungan', 'kantor']),
  walletType: z.enum(['cash', 'bank', 'ewallet']),
  openingBalance: z
    .number()
    .int()
    .min(0)
    .max(10 ** 13),
});

export const createCategorySchema = z.object({
  clientId: id,
  type: z.enum(['income', 'expense']),
  name: categoryName,
  icon,
  parentId: id.optional(),
});

export const updateCategorySchema = z.object({
  categoryId: id,
  name: categoryName,
  icon,
  parentId: id.nullable(),
});

export const archiveCategorySchema = z.object({ categoryId: id });

// ===== Skema hasil jsonb (kunci lain dibuang) =====
const entryResult = z.object({
  entry_id: z.uuid(),
  version: z.number().int(),
  replayed: z.boolean(),
  warnings: z.array(z.string()),
});
const spaceTransferResult = entryResult.extend({
  linked_entry_id: z.uuid(),
  link_id: z.uuid(),
});
/** Cocokkan saldo: `entry_id` null bila selisih 0 (tanpa entri). */
const reconcileResult = z.object({ entry_id: z.uuid().nullable(), replayed: z.boolean() });
const accountResult = z.object({ account_id: z.uuid() });
const archiveAccountResult = z.object({ account_id: z.uuid(), archived: z.boolean() });
const categoryResult = z.object({ category_id: z.uuid() });
const archiveResult = z.object({ category_id: z.uuid(), affected: z.number().int().min(0) });

// ===== Pembantu =====
type Table = 'accounts' | 'entries' | 'categories';

/** SQL tetap per tabel (tanpa interpolasi nama dari input). */
const IN_SPACE_SQL: Record<Table, string> = {
  accounts:
    'select count(*)::int as n from app.accounts where id = any($1::uuid[]) and space_id = $2',
  entries:
    'select count(*)::int as n from app.entries where id = any($1::uuid[]) and space_id = $2',
  categories:
    'select count(*)::int as n from app.categories where id = any($1::uuid[]) and space_id = $2',
};

/**
 * Semua `ids` terlihat (RLS member_read) dan berada di ruang `spaceId`; selain itu DK404.
 * Diekspor untuk wrapper lain di `server/ledger` (talangan).
 */
export async function assertInSpace(
  c: pg.PoolClient,
  table: Table,
  ids: string[],
  spaceId: string,
): Promise<void> {
  const unique = [...new Set(ids)];
  const { rows } = await c.query<{ n: number }>(IN_SPACE_SQL[table], [unique, spaceId]);
  if (rows[0]?.n !== unique.length) throw new NotInSpaceError();
}

/**
 * Satu panggilan `api.*` di satu transaksi ruang. `pre` = pemeriksaan ruang sebelum panggilan.
 * `fn` withLedger bisa berjalan hingga 4 kali: hanya kerja DB di dalamnya.
 * Diekspor untuk wrapper lain di `server/ledger` (talangan).
 */
export async function callApi<S extends z.ZodType>(
  ctx: LedgerCtx,
  pre: ((c: pg.PoolClient) => Promise<void>) | null,
  sql: string,
  params: unknown[],
  result: S,
): Promise<z.output<S>> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    if (pre) await pre(c);
    const { rows } = await c.query<{ r: unknown }>(sql, params);
    return result.parse(rows[0]?.r);
  });
}

// ===== Entri =====
export interface CreateEntryInput {
  clientId: string;
  accountId: string;
  kind: 'income' | 'expense';
  amount: Rupiah;
  categoryId: string;
  occurredOn?: IsoDate | undefined;
  description?: string | undefined;
  reimbursable?: boolean | undefined;
  allowNegative?: boolean | undefined;
}

export async function createEntry(
  ctx: LedgerCtx,
  i: CreateEntryInput,
): Promise<{ entryId: string; version: number; replayed: boolean; warnings: string[] }> {
  const v = createEntrySchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertInSpace(c, 'accounts', [v.accountId], ctx.spaceId),
    `select api.create_entry(
       p_client_id => $1, p_space_id => $2, p_account_id => $3, p_kind => $4::app.entry_kind,
       p_amount => $5::bigint, p_category_id => $6, p_occurred_on => $7::date,
       p_description => $8, p_reimbursable => $9, p_allow_negative => $10) as r`,
    [
      v.clientId,
      ctx.spaceId,
      v.accountId,
      v.kind,
      v.amount,
      v.categoryId,
      v.occurredOn ?? null,
      v.description ?? null,
      v.reimbursable ?? false,
      v.allowNegative ?? false,
    ],
    entryResult,
  );
  return { entryId: r.entry_id, version: r.version, replayed: r.replayed, warnings: r.warnings };
}

export interface CreateTransferInput {
  clientId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: Rupiah;
  fee?: Rupiah | undefined;
  occurredOn?: IsoDate | undefined;
  description?: string | undefined;
  allowNegative?: boolean | undefined;
}

/** Transfer dalam satu ruang saja (S6): kedua dompet wajib di ruang konteks. */
export async function createTransfer(
  ctx: LedgerCtx,
  i: CreateTransferInput,
): Promise<{ entryId: string; version: number; replayed: boolean }> {
  const v = createTransferSchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertInSpace(c, 'accounts', [v.fromAccountId, v.toAccountId], ctx.spaceId),
    `select api.create_transfer(
       p_client_id => $1, p_space_id => $2, p_from_account => $3, p_to_account => $4,
       p_amount => $5::bigint, p_fee => $6::bigint, p_occurred_on => $7::date, p_description => $8,
       p_allow_negative => $9) as r`,
    [
      v.clientId,
      ctx.spaceId,
      v.fromAccountId,
      v.toAccountId,
      v.amount,
      v.fee ?? 0,
      v.occurredOn ?? null,
      v.description ?? null,
      v.allowNegative ?? false,
    ],
    entryResult,
  );
  return { entryId: r.entry_id, version: r.version, replayed: r.replayed };
}

export interface CreateSpaceTransferInput {
  clientId: string;
  fromAccountId: string;
  toSpaceId: string;
  toAccountId: string;
  amount: Rupiah;
  fee: Rupiah;
  occurredOn?: IsoDate | undefined;
  description?: string | undefined;
  sharedNote?: string | undefined;
  allowNegative: boolean;
}

/**
 * Transfer antar ruang (S7, `kind = space_transfer`): `ctx.spaceId` = ruang sumber, dompet
 * sumber di ruang konteks, dompet tujuan di `toSpaceId` (user wajib anggota keduanya: dompet
 * ruang yang bukan miliknya tidak terlihat, jadi DK404). DB memisahkan privasi: `description`
 * hanya di kaki Pribadi, `sharedNote` hanya di kaki Bersama, biaya hanya di kaki sumber.
 * Hasil membawa id kedua kaki; pemanggil adalah pencatat dan anggota kedua ruang.
 */
export async function createSpaceTransfer(
  ctx: LedgerCtx,
  i: CreateSpaceTransferInput,
): Promise<{
  entryId: string;
  linkedEntryId: string;
  linkId: string;
  version: number;
  replayed: boolean;
}> {
  const v = createSpaceTransferSchema
    .refine((x) => x.toSpaceId !== ctx.spaceId, { path: ['toSpaceId'] })
    .parse(i);
  const r = await callApi(
    ctx,
    async (c) => {
      await c.query('select app.assert_member($1)', [v.toSpaceId]);
      await assertInSpace(c, 'accounts', [v.fromAccountId], ctx.spaceId);
      await assertInSpace(c, 'accounts', [v.toAccountId], v.toSpaceId);
    },
    `select api.create_transfer(
       p_client_id => $1, p_space_id => $2, p_from_account => $3, p_to_account => $4,
       p_amount => $5::bigint, p_fee => $6::bigint, p_occurred_on => $7::date,
       p_description => $8, p_shared_note => $9, p_allow_negative => $10) as r`,
    [
      v.clientId,
      ctx.spaceId,
      v.fromAccountId,
      v.toAccountId,
      v.amount,
      v.fee,
      v.occurredOn ?? null,
      v.description ?? null,
      v.sharedNote ?? null,
      v.allowNegative,
    ],
    spaceTransferResult,
  );
  return {
    entryId: r.entry_id,
    linkedEntryId: r.linked_entry_id,
    linkId: r.link_id,
    version: r.version,
    replayed: r.replayed,
  };
}

export interface UpdateEntryInput {
  clientId: string;
  entryId: string;
  expectedVersion: number;
  accountId: string;
  amount: Rupiah;
  categoryId: string | null;
  occurredOn: IsoDate | null;
  description: string | null;
  reimbursable: boolean;
  allowNegative?: boolean | undefined;
}

/** Ganti-penuh (BSD §9.1): semua field dikirim; `occurredOn` null = tanggal lama. */
export async function updateEntry(
  ctx: LedgerCtx,
  i: UpdateEntryInput,
): Promise<{ entryId: string; version: number }> {
  const v = updateEntrySchema.parse(i);
  const r = await callApi(
    ctx,
    async (c) => {
      await assertInSpace(c, 'entries', [v.entryId], ctx.spaceId);
      await assertInSpace(c, 'accounts', [v.accountId], ctx.spaceId);
    },
    `select api.update_entry(
       p_client_id => $1, p_entry_id => $2, p_expected_version => $3::int, p_account_id => $4,
       p_amount => $5::bigint, p_category_id => $6, p_occurred_on => $7::date,
       p_description => $8, p_reimbursable => $9, p_allow_negative => $10) as r`,
    [
      v.clientId,
      v.entryId,
      v.expectedVersion,
      v.accountId,
      v.amount,
      v.categoryId,
      v.occurredOn,
      v.description,
      v.reimbursable,
      v.allowNegative ?? false,
    ],
    entryResult,
  );
  return { entryId: r.entry_id, version: r.version };
}

export interface VoidEntryInput {
  clientId: string;
  entryId: string;
  expectedVersion: number;
  /** Batal yang membuat saldo negatif (mis. cicilan piutang): hanya sesudah `saldo_negatif` dikonfirmasi. */
  allowNegative?: boolean | undefined;
}

export async function voidEntry(ctx: LedgerCtx, i: VoidEntryInput): Promise<{ version: number }> {
  const v = voidEntrySchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertInSpace(c, 'entries', [v.entryId], ctx.spaceId),
    `select api.void_entry(
       p_client_id => $1, p_entry_id => $2, p_expected_version => $3::int,
       p_allow_negative => $4) as r`,
    [v.clientId, v.entryId, v.expectedVersion, v.allowNegative ?? false],
    entryResult,
  );
  return { version: r.version };
}

export type RestoreEntryInput = VoidEntryInput;

/** Pulihkan dari Sampah; lewat 90 hari sejak dibatalkan = DK422 `restore_window_closed`. */
export async function restoreEntry(
  ctx: LedgerCtx,
  i: RestoreEntryInput,
): Promise<{ version: number }> {
  const v = restoreEntrySchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertInSpace(c, 'entries', [v.entryId], ctx.spaceId),
    `select api.restore_entry(
       p_client_id => $1, p_entry_id => $2, p_expected_version => $3::int,
       p_allow_negative => $4) as r`,
    [v.clientId, v.entryId, v.expectedVersion, v.allowNegative ?? false],
    entryResult,
  );
  return { version: r.version };
}

export interface MoveEntryInput {
  clientId: string;
  entryId: string;
  expectedVersion: number;
  toSpaceId: string;
  accountId: string;
  categoryId: string;
  /** Tujuan Bersama: deskripsi ikut hanya bila `true` (tujuan Pribadi selalu ikut). */
  keepDescription?: boolean | undefined;
  allowNegative?: boolean | undefined;
}

/**
 * "Pindahkan ke ruang lain" (S7): entri income/expense di ruang konteks dibatalkan (ditandai
 * dipindah, tidak bisa dipulihkan: `entry_moved`) dan dibuat ulang di `toSpaceId` dengan dompet
 * dan kategori ruang tujuan. Hanya pencatat (`not_creator`). Id entri asal yang dikembalikan DB
 * (`moved_from_entry_id`) dibuang: pemanggil sudah memegangnya.
 */
export async function moveEntryToSpace(
  ctx: LedgerCtx,
  i: MoveEntryInput,
): Promise<{ entryId: string; version: number; replayed: boolean }> {
  const v = moveEntrySchema
    .refine((x) => x.toSpaceId !== ctx.spaceId, { path: ['toSpaceId'] })
    .parse(i);
  const r = await callApi(
    ctx,
    async (c) => {
      await c.query('select app.assert_member($1)', [v.toSpaceId]);
      await assertInSpace(c, 'entries', [v.entryId], ctx.spaceId);
      await assertInSpace(c, 'accounts', [v.accountId], v.toSpaceId);
      await assertInSpace(c, 'categories', [v.categoryId], v.toSpaceId);
    },
    `select api.move_entry_to_space(
       p_client_id => $1, p_entry_id => $2, p_expected_version => $3::int,
       p_to_space_id => $4, p_account_id => $5, p_category_id => $6,
       p_keep_description => $7, p_allow_negative => $8) as r`,
    [
      v.clientId,
      v.entryId,
      v.expectedVersion,
      v.toSpaceId,
      v.accountId,
      v.categoryId,
      v.keepDescription ?? false,
      v.allowNegative ?? false,
    ],
    entryResult,
  );
  return { entryId: r.entry_id, version: r.version, replayed: r.replayed };
}

// ===== Dompet =====
export interface CreateAccountInput {
  clientId: string;
  name: string;
  pocket: Pocket;
  walletType: WalletType;
  openingBalance: Rupiah;
}

/** Dompet baru dibuka hari ini (WIB server, `app.today()`); saldo awal 0 = tanpa entri. */
export async function createAccount(
  ctx: LedgerCtx,
  i: CreateAccountInput,
): Promise<{ accountId: string }> {
  const v = createAccountSchema.parse(i);
  const r = await callApi(
    ctx,
    null,
    `select api.create_account(
       p_client_id => $1, p_space_id => $2, p_name => $3, p_pocket => $4::app.pocket,
       p_wallet_type => $5::app.wallet_type, p_opening_balance => $6::bigint) as r`,
    [v.clientId, ctx.spaceId, v.name, v.pocket, v.walletType, v.openingBalance],
    accountResult,
  );
  return { accountId: r.account_id };
}

export interface ReconcileBalanceInput {
  clientId: string;
  accountId: string;
  actualBalance: Rupiah;
}

/**
 * Cocokkan saldo: DB menghitung selisih saldo nyata − saldo tercatat dan mencatat satu entri
 * `adjustment` bertanggal `app.today()` (WIB server; DB tidak menerima tanggal lain). Selisih 0 =
 * tanpa entri (`entryId: null`). `difference` dibaca dari baris utama entri itu di transaksi yang
 * sama, jadi replay mengembalikan selisih yang sama dengan panggilan pertama.
 */
export async function reconcileBalance(
  ctx: LedgerCtx,
  i: ReconcileBalanceInput,
): Promise<{ entryId: string | null; difference: number; replayed: boolean }> {
  const v = reconcileBalanceSchema.parse(i);
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    await assertInSpace(c, 'accounts', [v.accountId], ctx.spaceId);
    const { rows } = await c.query<{ r: unknown }>(
      `select api.reconcile_balance(
         p_client_id => $1, p_account_id => $2, p_target_balance => $3::bigint) as r`,
      [v.clientId, v.accountId, v.actualBalance],
    );
    const r = reconcileResult.parse(rows[0]?.r);
    if (r.entry_id === null) return { entryId: null, difference: 0, replayed: r.replayed };
    const line = await c.query<{ amount: number }>(
      `select l.amount from app.entry_lines l
        where l.space_id = $1 and l.entry_id = $2 and l.role = 'main'`,
      [ctx.spaceId, r.entry_id],
    );
    const difference = line.rows[0]?.amount;
    // Entri adjustment sudah dihapus permanen (replay sesudah purge): tidak mengarang selisih.
    if (difference === undefined) throw new Error('selisih cocokkan saldo tidak terbaca');
    return { entryId: r.entry_id, difference, replayed: r.replayed };
  });
}

/**
 * Arsip dompet: hanya bila saldo 0 (`balance_not_zero`); idempoten secara alami (dompet yang
 * sudah terarsip = `archived: true` lagi).
 */
export async function archiveAccount(
  ctx: LedgerCtx,
  accountId: string,
): Promise<{ archived: boolean }> {
  const v = archiveAccountSchema.parse({ accountId });
  const r = await callApi(
    ctx,
    (c) => assertInSpace(c, 'accounts', [v.accountId], ctx.spaceId),
    'select api.archive_account(p_account_id => $1) as r',
    [v.accountId],
    archiveAccountResult,
  );
  return { archived: r.archived };
}

// ===== Kategori =====
export interface CreateCategoryInput {
  clientId: string;
  type: 'income' | 'expense';
  name: string;
  icon: string;
  parentId?: string | undefined;
}

export async function createCategory(
  ctx: LedgerCtx,
  i: CreateCategoryInput,
): Promise<{ categoryId: string }> {
  const v = createCategorySchema.parse(i);
  const parentId = v.parentId;
  const r = await callApi(
    ctx,
    parentId === undefined ? null : (c) => assertInSpace(c, 'categories', [parentId], ctx.spaceId),
    `select api.create_category(
       p_client_id => $1, p_space_id => $2, p_type => $3::app.category_type, p_name => $4,
       p_icon => $5, p_parent_id => $6) as r`,
    [v.clientId, ctx.spaceId, v.type, v.name, v.icon, v.parentId ?? null],
    categoryResult,
  );
  return { categoryId: r.category_id };
}

export interface UpdateCategoryInput {
  categoryId: string;
  name: string;
  icon: string;
  parentId: string | null;
}

/** Ganti penuh nama, ikon, induk; idempoten secara alami (tanpa `clientId`). */
export async function updateCategory(ctx: LedgerCtx, i: UpdateCategoryInput): Promise<void> {
  const v = updateCategorySchema.parse(i);
  await callApi(
    ctx,
    (c) =>
      assertInSpace(
        c,
        'categories',
        v.parentId === null ? [v.categoryId] : [v.categoryId, v.parentId],
        ctx.spaceId,
      ),
    `select api.update_category(
       p_category_id => $1, p_name => $2, p_icon => $3, p_parent_id => $4) as r`,
    [v.categoryId, v.name, v.icon, v.parentId],
    categoryResult,
  );
}

/** Arsip kategori (anak aktif ikut); `affected` = baris yang berubah, panggilan kedua = 0. */
export async function archiveCategory(
  ctx: LedgerCtx,
  i: { categoryId: string },
): Promise<{ affected: number }> {
  const v = archiveCategorySchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertInSpace(c, 'categories', [v.categoryId], ctx.spaceId),
    'select api.archive_category(p_category_id => $1) as r',
    [v.categoryId],
    archiveResult,
  );
  return { affected: r.affected };
}

// ===== Hari tanpa pengeluaran =====
/**
 * Tanggal = `app.today()` (WIB server), bukan zona browser; dua kali = satu baris.
 * `created` = hari ini belum ditandai sebelum panggilan ini (dibaca di transaksi yang sama, sebelum
 * `api.mark_no_spend_day`): event `tanpa_pengeluaran` hanya dicatat untuk tanda baru.
 * Dua klik serentak (READ COMMITTED) bisa sama-sama `created: true`; baris tetap satu.
 */
export async function markNoSpendDay(ctx: LedgerCtx): Promise<{ created: boolean }> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<{ marked: boolean }>(
      `select exists (
         select 1 from app.no_spend_days where space_id = $1 and on_date = app.today()
       ) as marked`,
      [ctx.spaceId],
    );
    // Fungsi `returns void`: tidak ada jsonb untuk divalidasi.
    await c.query('select api.mark_no_spend_day(p_space_id => $1)', [ctx.spaceId]);
    return { created: rows[0]?.marked === false };
  });
}
