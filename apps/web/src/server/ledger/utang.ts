import 'server-only';
import type pg from 'pg';
import { z } from 'zod';
import type {
  ContactVM,
  DebtDetailVM,
  DebtEffectVM,
  DebtListItemVM,
  DebtNumbersVM,
  UtangData,
} from '@/features/utang/types';
import { withLedger } from './retry';
import { assertInSpace, callApi, NotInSpaceError, type LedgerCtx } from './write';

/**
 * Utang/piutang dan kontak (S11, plan Task 5; API DB `0131_utang_api.sql`). Pola `rencana.ts`:
 * - Zod sebelum pool; hasil `jsonb` divalidasi Zod di dalam transaksi (hasil asing = rollback);
 * - bacaan `fooTx(c, ctx)` di transaksi pemanggil, `loadUtang`/`loadKontak`/`loadDebtDetail`
 *   satu `withLedger` masing-masing (hanya saat bagiannya dibuka, terpisah dari `loadRencana`);
 * - fungsi yang hanya menerima id (utang, kontak, dompet) didahului cek ruang: baris wajib di
 *   `ctx.spaceId` (`NotInSpaceError` = DK404 → `not_found`), jadi utang Pribadi tidak bisa disentuh
 *   dari rute Bersama walau user anggota keduanya. Ruang Bersama ditolak lebih awal oleh action
 *   (`debt_personal_only`, B10) dan oleh DB;
 * - uang = bilangan bulat rupiah dari SQL, tanpa penjumlahan di sini. Tidak ada log di sini.
 * Batal/pulihkan satu cicilan = `voidEntry`/`restoreEntry` biasa (`write.ts`).
 */

/**
 * Utang hanya di Pribadi (B10): dilempar action SEBELUM menyentuh DB bila ruang argumen Bersama.
 * Bentuk galat domain (`DK422`) agar `toLedgerError` memetakannya seperti penolakan DB.
 */
export class DebtPersonalOnlyError extends Error {
  readonly code = 'DK422';
  constructor() {
    super('debt_personal_only');
    this.name = 'DebtPersonalOnlyError';
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
const contactName = z.string().trim().min(1).max(60);
const title = z.string().trim().max(80);
const note = z.string().trim().max(200);
const direction = z.enum(['borrowed', 'lent']);

export const createContactSchema = z.object({ clientId: id, name: contactName });
export const renameContactSchema = z.object({ contactId: id, name: contactName });
export const contactIdSchema = z.object({ contactId: id });

/**
 * Kontak: `contactId` (kontak aktif) ATAU `contactName` (kontak baru, dibuat bersama utangnya, ikut
 * idempoten). Dompet wajib tepat untuk mode `baru` (K2).
 */
export const createDebtSchema = z
  .object({
    clientId: id,
    direction,
    principal: amount,
    mode: z.enum(['baru', 'berjalan']),
    contactId: id.optional(),
    contactName: contactName.optional(),
    accountId: id.optional(),
    openedOn: isoDate.optional(),
    title: title.optional(),
    note: note.optional(),
    allowNegative: z.boolean().optional(),
  })
  .refine((v) => (v.contactId === undefined) !== (v.contactName === undefined), {
    path: ['contactId'],
  })
  .refine((v) => (v.mode === 'baru') === (v.accountId !== undefined), { path: ['accountId'] });

/** Ganti penuh (K4): `null`/kosong = kosongkan judul/catatan; tanpa efek ledger. */
export const updateDebtInfoSchema = z.object({
  debtId: id,
  contactId: id,
  title: title.nullable(),
  note: note.nullable(),
});

export const payDebtSchema = z.object({
  clientId: id,
  debtId: id,
  accountId: id,
  amount,
  occurredOn: isoDate.optional(),
  allowNegative: z.boolean().optional(),
});

/** Hapus/pulihkan utang (K5): idempoten lewat `clientId`. */
export const debtActionSchema = z.object({
  clientId: id,
  debtId: id,
  allowNegative: z.boolean().optional(),
});

export const debtIdSchema = z.object({ debtId: id });

// ===== Skema hasil =====
const money = z.number().int();
const quick = z.object({ p25: money.nullable(), p50: money.nullable(), full: money });
const numbers = z.object({
  principal: money,
  paid: money,
  remaining: money.min(0),
  paid_pct: z.number().int().min(0).max(100),
  settled: z.boolean(),
  quick,
});
const contactResult = z.object({ contact_id: z.uuid(), name: z.string(), replayed: z.boolean() });
const renameResult = z.object({ contact_id: z.uuid(), name: z.string() });
const archiveContactResult = z.object({ contact_id: z.uuid(), archived: z.literal(true) });
const createDebtResult = numbers.extend({
  debt_id: z.uuid(),
  contact_id: z.uuid(),
  entry_id: z.uuid().nullable(),
  version: z.number().int(),
  warnings: z.array(z.string()),
  replayed: z.boolean(),
});
const updateDebtResult = z.object({ debt_id: z.uuid() });
const payDebtResult = numbers.extend({
  entry_id: z.uuid(),
  debt_id: z.uuid(),
  version: z.number().int(),
  warnings: z.array(z.string()),
  replayed: z.boolean(),
});
const effect = z.object({ account_id: z.guid(), account_name: z.string(), amount: money });
const voidDebtResult = z.object({
  debt_id: z.uuid(),
  affected: z.array(z.guid()),
  effects: z.array(effect),
  warnings: z.array(z.string()),
  replayed: z.boolean(),
});
const restoreDebtResult = voidDebtResult.extend(numbers.shape);

/** Stempel `timestamptz` di `jsonb` (zona sesi apa pun) → ISO WIB tanpa pecahan detik. */
const instant = z.string().transform((s, c) => {
  const t = Date.parse(s);
  if (Number.isNaN(t)) {
    c.addIssue({ code: 'custom', message: 'stempel waktu' });
    return z.NEVER;
  }
  return toWib(t);
});

export function toWib(ms: number): string {
  return `${new Date(ms + 7 * 3_600_000).toISOString().slice(0, 19)}+07:00`;
}

const detailResult = numbers.extend({
  debt_id: z.guid(),
  contact_id: z.guid(),
  contact_name: z.string(),
  contact_archived: z.boolean(),
  direction,
  mode: z.enum(['baru', 'berjalan']),
  title: z.string().nullable(),
  note: z.string().nullable(),
  opened_on: z.iso.date(),
  created_at: instant,
  voided_at: instant.nullable(),
  principal_entry_id: z.guid().nullable(),
  account_id: z.guid().nullable(),
  account_name: z.string().nullable(),
  payments: z.array(
    z.object({
      entry_id: z.guid(),
      version: z.number().int().min(1),
      occurred_on: z.iso.date(),
      account_id: z.guid(),
      account_name: z.string(),
      amount: money.positive(),
      voided: z.boolean(),
      voided_at: instant.nullable(),
      voided_with_debt: z.boolean(),
      created_at: instant,
    }),
  ),
  void_effects: z.array(effect),
});

const debtRow = z.object({
  debt_id: z.guid(),
  contact_id: z.guid(),
  contact_name: z.string(),
  direction,
  mode: z.enum(['baru', 'berjalan']),
  title: z.string().nullable(),
  principal: money,
  paid: money,
  remaining: money.min(0),
  paid_pct: z.number().int().min(0).max(100),
  quick_25: money.nullable(),
  quick_50: money.nullable(),
  opened_on: z.iso.date(),
  account_id: z.guid().nullable(),
  voided_at: z.string().nullable(),
  direction_remaining: money,
  direction_contacts: z.number().int(),
});

const contactRow = z.object({
  contact_id: z.guid(),
  name: z.string(),
  borrowed_remaining: money,
  lent_remaining: money,
  borrowed_count: z.number().int(),
  lent_count: z.number().int(),
});

// ===== Pembantu =====
function numbersOf(r: z.output<typeof numbers>): DebtNumbersVM {
  return {
    principal: r.principal,
    paid: r.paid,
    remaining: r.remaining,
    paidPct: r.paid_pct,
    settled: r.settled,
    quick: { p25: r.quick.p25, p50: r.quick.p50, full: r.quick.full },
  };
}

function effectsOf(rows: z.output<typeof effect>[]): DebtEffectVM[] {
  return rows.map((e) => ({
    accountId: e.account_id,
    accountName: e.account_name,
    amount: e.amount,
  }));
}

type UtangTable = 'debts' | 'contacts';

/** SQL tetap per tabel (tanpa interpolasi nama dari input). */
const IN_SPACE_SQL: Record<UtangTable, string> = {
  debts: 'select count(*)::int as n from app.debts where id = $1 and space_id = $2',
  contacts: 'select count(*)::int as n from app.contacts where id = $1 and space_id = $2',
};

async function assertRowInSpace(
  c: pg.PoolClient,
  table: UtangTable,
  rowId: string,
  spaceId: string,
): Promise<void> {
  const { rows } = await c.query<{ n: number }>(IN_SPACE_SQL[table], [rowId, spaceId]);
  if (rows[0]?.n !== 1) throw new NotInSpaceError();
}

// ===== Baca =====
/** `api.list_debts` (urutan SQL: hidup bersisa, lunas, terhapus) + total kartu `Sisa` per arah. */
export async function listDebtsTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
): Promise<Pick<UtangData, 'debts' | 'totals'>> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select d.debt_id, d.contact_id, d.contact_name, d.direction, d.mode, d.title, d.principal,
            d.paid, d.remaining, d.paid_pct, d.quick_25, d.quick_50, d.opened_on, d.account_id,
            to_char(d.voided_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI:SS"+07:00"')
              as voided_at,
            d.direction_remaining, d.direction_contacts
       from api.list_debts(p_space_id => $1) with ordinality as d (
              debt_id, contact_id, contact_name, direction, mode, title, principal, paid,
              remaining, paid_pct, quick_25, quick_50, opened_on, account_id, voided_at,
              direction_remaining, direction_contacts, n)
      order by d.n`,
    [ctx.spaceId],
  );
  const totals: UtangData['totals'] = {
    borrowed: { remaining: 0, contacts: 0 },
    lent: { remaining: 0, contacts: 0 },
  };
  const debts = rows.map((raw): DebtListItemVM => {
    const r = debtRow.parse(raw);
    // Sama di setiap baris searah (SQL); diambil apa adanya, tidak dijumlah.
    totals[r.direction] = { remaining: r.direction_remaining, contacts: r.direction_contacts };
    return {
      debtId: r.debt_id,
      contactId: r.contact_id,
      contactName: r.contact_name,
      direction: r.direction,
      mode: r.mode,
      title: r.title,
      principal: r.principal,
      paid: r.paid,
      remaining: r.remaining,
      paidPct: r.paid_pct,
      settled: r.remaining === 0,
      quick: { p25: r.quick_25, p50: r.quick_50, full: r.remaining },
      openedOn: r.opened_on,
      accountId: r.account_id,
      voidedAt: r.voided_at,
    };
  });
  return { debts, totals };
}

/** `api.list_contacts`: kontak aktif urut nama + Σ sisa dan jumlah utang aktif per arah (SQL). */
export async function listContactsTx(c: pg.PoolClient, ctx: LedgerCtx): Promise<ContactVM[]> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select k.contact_id, k.name, k.borrowed_remaining, k.lent_remaining, k.borrowed_count,
            k.lent_count
       from api.list_contacts(p_space_id => $1) with ordinality as k (
              contact_id, name, borrowed_remaining, lent_remaining, borrowed_count, lent_count, n)
      order by k.n`,
    [ctx.spaceId],
  );
  return rows.map((raw) => {
    const r = contactRow.parse(raw);
    return {
      contactId: r.contact_id,
      name: r.name,
      borrowedRemaining: r.borrowed_remaining,
      lentRemaining: r.lent_remaining,
      borrowedCount: r.borrowed_count,
      lentCount: r.lent_count,
    };
  });
}

/** Segmen Utang di Rencana (S11-UT1): daftar utang, total per arah, kontak aktif. */
export async function loadUtang(ctx: LedgerCtx): Promise<UtangData> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { debts, totals } = await listDebtsTx(c, ctx);
    const contacts = await listContactsTx(c, ctx);
    return { debts, totals, contacts };
  });
}

/** Halaman Kontak (S11-KT1). */
export async function loadKontak(ctx: LedgerCtx): Promise<ContactVM[]> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, (c) => listContactsTx(c, ctx));
}

/**
 * Detail utang (S11-DT1). `null` = tidak ada, di ruang lain, atau SUDAH DIHAPUS: halaman memanggil
 * `notFound()` (pemulihan lewat grup `Utang dihapus` di daftar).
 */
export async function loadDebtDetail(ctx: LedgerCtx, debtId: string): Promise<DebtDetailVM | null> {
  const v = debtIdSchema.safeParse({ debtId });
  if (!v.success) return null;
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const own = await c.query<{ n: number }>(IN_SPACE_SQL.debts, [v.data.debtId, ctx.spaceId]);
    if (own.rows[0]?.n !== 1) return null;
    const { rows } = await c.query<{ r: unknown }>('select api.debt_detail(p_debt_id => $1) as r', [
      v.data.debtId,
    ]);
    const r = detailResult.parse(rows[0]?.r);
    if (r.voided_at !== null) return null;
    return {
      ...numbersOf(r),
      debtId: r.debt_id,
      contactId: r.contact_id,
      contactName: r.contact_name,
      contactArchived: r.contact_archived,
      direction: r.direction,
      mode: r.mode,
      title: r.title,
      note: r.note,
      openedOn: r.opened_on,
      createdAt: r.created_at,
      principalEntryId: r.principal_entry_id,
      accountId: r.account_id,
      accountName: r.account_name,
      payments: r.payments.map((p) => ({
        entryId: p.entry_id,
        version: p.version,
        occurredOn: p.occurred_on,
        accountId: p.account_id,
        accountName: p.account_name,
        amount: p.amount,
        voided: p.voided,
        voidedAt: p.voided_at,
        voidedWithDebt: p.voided_with_debt,
        createdAt: p.created_at,
      })),
      voidEffects: effectsOf(r.void_effects),
    };
  });
}

// ===== Tulis: kontak =====
export interface ContactValue {
  contactId: string;
  name: string;
}

/** `api.create_contact` (idempoten lewat `clientId`). */
export async function createContact(
  ctx: LedgerCtx,
  i: z.input<typeof createContactSchema>,
): Promise<ContactValue & { replayed: boolean }> {
  const v = createContactSchema.parse(i);
  const r = await callApi(
    ctx,
    null,
    'select api.create_contact(p_client_id => $1, p_space_id => $2, p_name => $3) as r',
    [v.clientId, ctx.spaceId, v.name],
    contactResult,
  );
  return { contactId: r.contact_id, name: r.name, replayed: r.replayed };
}

/** `api.rename_contact`: berlaku di semua utang kontak itu, tanpa efek angka. */
export async function renameContact(
  ctx: LedgerCtx,
  i: z.input<typeof renameContactSchema>,
): Promise<ContactValue> {
  const v = renameContactSchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertRowInSpace(c, 'contacts', v.contactId, ctx.spaceId),
    'select api.rename_contact(p_contact_id => $1, p_name => $2) as r',
    [v.contactId, v.name],
    renameResult,
  );
  return { contactId: r.contact_id, name: r.name };
}

/** `api.archive_contact` (idempoten alami): hilang dari pemilih, utang lama tetap. */
export async function archiveContact(
  ctx: LedgerCtx,
  i: z.input<typeof contactIdSchema>,
): Promise<{ contactId: string }> {
  const v = contactIdSchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertRowInSpace(c, 'contacts', v.contactId, ctx.spaceId),
    'select api.archive_contact(p_contact_id => $1) as r',
    [v.contactId],
    archiveContactResult,
  );
  return { contactId: r.contact_id };
}

// ===== Tulis: utang =====
export interface CreateDebtValue extends DebtNumbersVM {
  debtId: string;
  contactId: string;
  /** Entri pokok (mode baru); `null` untuk berjalan. */
  entryId: string | null;
  version: number;
  replayed: boolean;
  warnings: string[];
}

/** `api.create_debt` (K2): mode baru = utang + entri pokok; berjalan = utang saja. */
export async function createDebt(
  ctx: LedgerCtx,
  i: z.input<typeof createDebtSchema>,
): Promise<CreateDebtValue> {
  const v = createDebtSchema.parse(i);
  const r = await callApi(
    ctx,
    async (c) => {
      if (v.contactId !== undefined) {
        await assertRowInSpace(c, 'contacts', v.contactId, ctx.spaceId);
      }
      if (v.accountId !== undefined) {
        await assertInSpace(c, 'accounts', [v.accountId], ctx.spaceId);
      }
    },
    `select api.create_debt(
       p_client_id => $1, p_space_id => $2, p_direction => $3, p_principal => $4::bigint,
       p_mode => $5, p_contact_id => $6, p_contact_name => $7, p_account_id => $8,
       p_opened_on => $9::date, p_title => $10, p_note => $11, p_allow_negative => $12) as r`,
    [
      v.clientId,
      ctx.spaceId,
      v.direction,
      v.principal,
      v.mode,
      v.contactId ?? null,
      v.contactName ?? null,
      v.accountId ?? null,
      v.openedOn ?? null,
      v.title ?? null,
      v.note ?? null,
      v.allowNegative ?? false,
    ],
    createDebtResult,
  );
  return {
    ...numbersOf(r),
    debtId: r.debt_id,
    contactId: r.contact_id,
    entryId: r.entry_id,
    version: r.version,
    replayed: r.replayed,
    warnings: r.warnings,
  };
}

/** `api.update_debt_info` (K4, T6): kontak, judul, catatan; tanpa efek ledger. */
export async function updateDebtInfo(
  ctx: LedgerCtx,
  i: z.input<typeof updateDebtInfoSchema>,
): Promise<{ debtId: string }> {
  const v = updateDebtInfoSchema.parse(i);
  const r = await callApi(
    ctx,
    async (c) => {
      await assertRowInSpace(c, 'debts', v.debtId, ctx.spaceId);
      await assertRowInSpace(c, 'contacts', v.contactId, ctx.spaceId);
    },
    `select api.update_debt_info(
       p_debt_id => $1, p_contact_id => $2, p_title => $3, p_note => $4) as r`,
    [v.debtId, v.contactId, v.title, v.note],
    updateDebtResult,
  );
  return { debtId: r.debt_id };
}

export interface PayDebtValue extends DebtNumbersVM {
  entryId: string;
  debtId: string;
  version: number;
  replayed: boolean;
  warnings: string[];
}

/**
 * `api.pay_debt` (T7, K7): bayar > sisa = `payment_exceeds` tanpa efek; klik ganda (clientId sama)
 * = satu entri (C6). Angka hasil = sesudah pembayaran ini SAAT PERTAMA dicatat (replay tidak
 * memperbarui).
 */
export async function payDebt(
  ctx: LedgerCtx,
  i: z.input<typeof payDebtSchema>,
): Promise<PayDebtValue> {
  const v = payDebtSchema.parse(i);
  const r = await callApi(
    ctx,
    async (c) => {
      await assertRowInSpace(c, 'debts', v.debtId, ctx.spaceId);
      await assertInSpace(c, 'accounts', [v.accountId], ctx.spaceId);
    },
    `select api.pay_debt(
       p_client_id => $1, p_debt_id => $2, p_account_id => $3, p_amount => $4::bigint,
       p_occurred_on => $5::date, p_allow_negative => $6) as r`,
    [v.clientId, v.debtId, v.accountId, v.amount, v.occurredOn ?? null, v.allowNegative ?? false],
    payDebtResult,
  );
  return {
    ...numbersOf(r),
    entryId: r.entry_id,
    debtId: r.debt_id,
    version: r.version,
    replayed: r.replayed,
    warnings: r.warnings,
  };
}

export interface VoidDebtValue {
  debtId: string;
  /** Entri yang ikut dibatalkan/dipulihkan. */
  affected: string[];
  /** Perubahan saldo per dompet (tanpa nol). */
  effects: DebtEffectVM[];
  replayed: boolean;
}

/** `api.void_debt` (K5, T9): pokok + semua cicilan hidup dibatalkan atomik. */
export async function voidDebt(
  ctx: LedgerCtx,
  i: z.input<typeof debtActionSchema>,
): Promise<VoidDebtValue> {
  const v = debtActionSchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertRowInSpace(c, 'debts', v.debtId, ctx.spaceId),
    'select api.void_debt(p_client_id => $1, p_debt_id => $2, p_allow_negative => $3) as r',
    [v.clientId, v.debtId, v.allowNegative ?? false],
    voidDebtResult,
  );
  return {
    debtId: r.debt_id,
    affected: r.affected,
    effects: effectsOf(r.effects),
    replayed: r.replayed,
  };
}

/** `api.restore_debt` (K5): entri yang ikut Hapus utang kembali (90 hari). */
export async function restoreDebt(
  ctx: LedgerCtx,
  i: z.input<typeof debtActionSchema>,
): Promise<VoidDebtValue & DebtNumbersVM> {
  const v = debtActionSchema.parse(i);
  const r = await callApi(
    ctx,
    (c) => assertRowInSpace(c, 'debts', v.debtId, ctx.spaceId),
    'select api.restore_debt(p_client_id => $1, p_debt_id => $2, p_allow_negative => $3) as r',
    [v.clientId, v.debtId, v.allowNegative ?? false],
    restoreDebtResult,
  );
  return {
    ...numbersOf(r),
    debtId: r.debt_id,
    affected: r.affected,
    effects: effectsOf(r.effects),
    replayed: r.replayed,
  };
}
