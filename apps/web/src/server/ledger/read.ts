import 'server-only';
import type pg from 'pg';
import { z } from 'zod';
import type { Rupiah } from '@dompetku/domain';
import type {
  AccountVM,
  CategoryVM,
  EntryVM,
  HistoryVM,
  MonthSummaryVM,
  Pocket,
  SafeToSpendVM,
  TodayStatusVM,
  TrashVM,
  WalletType,
} from '@/features/ledger/types';
import { withLedger } from './retry';
import type { LedgerCtx } from './write';

/**
 * Loader baca ledger (server saja): view-model untuk Beranda, Transaksi, Dompet, Sampah.
 * Aturan:
 * - satu transaksi pendek `withLedger` per loader (konteks user + `app.assert_member`), hanya
 *   kerja DB di dalamnya (bisa diulang 40001/40P01);
 * - setiap kueri dibatasi `space_id = ctx.spaceId` secara eksplisit, selain RLS: baris tidak
 *   pernah dipilih lewat id saja, dan join ikut membawa `space_id` yang sama;
 * - kaki `space_transfer` hanya membawa dompet ruangnya sendiri; dompet lawan
 *   (`counterAccount*`) hanya untuk transfer satu ruang, dan deskripsi kaki ruang Bersama tidak
 *   pernah dikirim (BSD §6 privasi transfer; kolomnya memang NULL di DB);
 * - "hari ini" dan bulan berjalan = `app.today()` (WIB server), bukan jam Node;
 * - stempel waktu dikirim sebagai ISO WIB `YYYY-MM-DDTHH:MM:SS+07:00` (bentuk data demo),
 *   tanggal (`date`) tetap string dan `int8` number (parser `server/db.ts`).
 * Tidak ada log di sini (nominal dan deskripsi tidak pernah dilog).
 */

// ===== Skema input =====
const uuid = z.uuid();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const limit = z.number().int().min(1).max(100);
/** Diekspor untuk server action `suggestFor` (satu sumber batas). */
export const suggestSchema = z.object({
  type: z.enum(['income', 'expense']),
  hour: z.number().int().min(0).max(23).optional(),
  amount: z
    .number()
    .int()
    .min(0)
    .max(10 ** 13)
    .optional(),
  description: z.string().max(200).optional(),
});

// ===== Pembantu =====
/** Stempel waktu → ISO WIB (sama dengan data demo; `timeLabelWIB` membaca jamnya). */
const wib = (col: string) =>
  `to_char(${col} at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI:SS"+07:00"')`;

/** Huruf pertama nama roster, kapital (aman untuk karakter di luar BMP). */
function initialOf(name: string): string {
  return (Array.from(name)[0] ?? '').toUpperCase();
}

interface Person {
  id: string;
  name: string;
}

function person(id: string, name: string | null): Person {
  // Pembuat entri selalu anggota ruang (S6 tidak punya keluar ruang); bila tidak, lebih baik gagal
  // daripada mengarang nama.
  if (name === null) throw new Error('pembuat bukan anggota ruang');
  return { id, name };
}

const ENTRY_KINDS = new Set<EntryVM['kind']>([
  'income',
  'expense',
  'transfer',
  'opening_balance',
  'space_transfer',
  'adjustment',
  // S7: reimburse talangan (satu baris utama +nominal, seperti pemasukan).
  'reimbursement',
]);

function entryKind(kind: string): EntryVM['kind'] {
  if (!ENTRY_KINDS.has(kind as EntryVM['kind'])) throw new Error('jenis entri tidak dikenal');
  return kind as EntryVM['kind'];
}

// ===== Entri =====
interface EntryRow {
  id: string;
  version: number;
  kind: string;
  space_kind: 'personal' | 'shared';
  occurred_on: string;
  created_at: string;
  created_by: string;
  created_by_name: string | null;
  account_id: string;
  account_name: string;
  amount: number;
  main_in: boolean;
  counter_account_id: string | null;
  counter_account_name: string | null;
  category_id: string | null;
  category_name: string | null;
  category_icon: string | null;
  description: string | null;
  voided_at: string | null;
  direction: 'out' | 'in' | null;
  shared_note: string | null;
  reimbursable: boolean;
}

/**
 * Kolom + join entri. `$1` = ruang konteks; setiap join memakai `space_id` entri. Baris lawan
 * (`counter`) hanya ada di transfer satu ruang: kaki `space_transfer` tidak punya baris lawan
 * (lawannya entri lain di ruang lain, lewat `link_id`, yang tidak pernah diikuti di sini).
 */
const ENTRY_COLUMNS = `
  e.id, e.version, e.kind::text as kind, e.space_kind::text as space_kind, e.occurred_on,
  ${wib('e.created_at')} as created_at, e.created_by, r.display_name as created_by_name,
  m.account_id, ma.name as account_name, abs(m.amount) as amount, m.amount > 0 as main_in,
  case when e.kind = 'transfer' then c.account_id end as counter_account_id,
  case when e.kind = 'transfer' then ca.name end as counter_account_name,
  e.category_id, cat.name as category_name, cat.icon as category_icon,
  e.description, ${wib('e.voided_at')} as voided_at, e.direction::text as direction,
  e.shared_note, e.reimbursable`;

const ENTRY_JOINS = `
  join app.entry_lines m
    on m.space_id = e.space_id and m.entry_id = e.id and m.role = 'main'
  join app.accounts ma on ma.space_id = e.space_id and ma.id = m.account_id
  left join app.entry_lines c
    on c.space_id = e.space_id and c.entry_id = e.id and c.role = 'counter'
  left join app.accounts ca on ca.space_id = e.space_id and ca.id = c.account_id
  left join app.categories cat on cat.space_id = e.space_id and cat.id = e.category_id
  left join app.space_roster($1) r on r.user_id = e.created_by`;

const ENTRY_ORDER = 'order by e.occurred_on desc, e.created_at desc, e.id desc';

function toEntryVM(row: EntryRow): EntryVM {
  const by = person(row.created_by, row.created_by_name);
  const kind = entryKind(row.kind);
  const vm: EntryVM = {
    id: row.id,
    version: row.version,
    kind,
    occurredOn: row.occurred_on,
    createdAt: row.created_at,
    createdBy: { ...by, initial: initialOf(by.name) },
    accountId: row.account_id,
    accountName: row.account_name,
    amount: row.amount,
  };
  if (kind === 'transfer' && row.counter_account_id !== null) {
    vm.counterAccountId = row.counter_account_id;
    if (row.counter_account_name !== null) vm.counterAccountName = row.counter_account_name;
  }
  if (row.category_id !== null) vm.categoryId = row.category_id;
  if (row.category_name !== null) vm.categoryName = row.category_name;
  if (row.category_icon !== null) vm.categoryIcon = row.category_icon;
  // Pertahanan berlapis: deskripsi kaki Bersama tidak pernah dikirim walau kolomnya terisi.
  const privateLeg = kind === 'space_transfer' && row.space_kind === 'shared';
  if (row.description !== null && !privateLeg) vm.description = row.description;
  if (row.voided_at !== null) vm.voidedAt = row.voided_at;
  if (kind === 'space_transfer' && row.direction !== null) vm.direction = row.direction;
  // Cocokkan saldo: nominal tetap absolut, arah dari tanda baris utama (naik = in, turun = out).
  if (kind === 'adjustment') vm.direction = row.main_in ? 'in' : 'out';
  if (row.shared_note !== null) vm.sharedNote = row.shared_note;
  // Ubah = ganti-penuh: nilai talangan sekarang harus ikut terkirim apa adanya.
  if (row.reimbursable) vm.reimbursable = true;
  return vm;
}

async function queryEntries(c: pg.PoolClient, sql: string, params: unknown[]): Promise<EntryVM[]> {
  const { rows } = await c.query<EntryRow>(sql, params);
  return rows.map(toEntryVM);
}

/**
 * Entri hidup ruang ini pada satu bulan WIB, terbaru di atas; `accountId` = baris utama/lawan.
 * Dibatasi 1000 baris sebagai pengaman; paginasi ditunda (belum ada penanda "lainnya").
 */
export async function listEntries(
  ctx: LedgerCtx,
  i: { month: string; accountId?: string },
): Promise<EntryVM[]> {
  const m = month.parse(i.month);
  const accountId = i.accountId === undefined ? null : uuid.parse(i.accountId);
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, (c) =>
    queryEntries(
      c,
      `select ${ENTRY_COLUMNS}
         from app.entries e ${ENTRY_JOINS}
        where e.space_id = $1 and e.voided_at is null
          and e.occurred_on >= $2::date
          and e.occurred_on < ($2::date + interval '1 month')::date
          and ($3::uuid is null or exists (
                select 1 from app.entry_lines l
                 where l.space_id = e.space_id and l.entry_id = e.id and l.account_id = $3))
        ${ENTRY_ORDER}
        limit 1000`,
      [ctx.spaceId, `${m}-01`, accountId],
    ),
  );
}

/** Batas atas jumlah entri riwayat satu dompet per halaman (`?tampil=`). */
export const ACCOUNT_HISTORY_MAX = 1000;
const historyLimit = z.number().int().min(1).max(ACCOUNT_HISTORY_MAX);

/**
 * Riwayat satu dompet (semua bulan): entri hidup yang menyentuh dompet ini sebagai baris utama atau
 * lawan, terbaru di atas, dibatasi `n` (`hasMore` bila masih ada yang lebih lama). Entri pembuka
 * (Saldo awal) dikembalikan terpisah dan tidak ikut hitungan `n`, supaya tidak terpotong.
 */
export async function accountEntries(
  ctx: LedgerCtx,
  accountId: string,
  n: number,
): Promise<{ entries: EntryVM[]; opening: EntryVM[]; hasMore: boolean }> {
  const id = uuid.parse(accountId);
  const l = historyLimit.parse(n);
  const touches = `exists (
            select 1 from app.entry_lines l
             where l.space_id = e.space_id and l.entry_id = e.id and l.account_id = $2)`;
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const rows = await queryEntries(
      c,
      `select ${ENTRY_COLUMNS}
         from app.entries e ${ENTRY_JOINS}
        where e.space_id = $1 and e.voided_at is null and e.kind <> 'opening_balance'
          and ${touches}
        ${ENTRY_ORDER}
        limit $3`,
      [ctx.spaceId, id, l + 1],
    );
    const opening = await queryEntries(
      c,
      `select ${ENTRY_COLUMNS}
         from app.entries e ${ENTRY_JOINS}
        where e.space_id = $1 and e.voided_at is null and e.kind = 'opening_balance'
          and ${touches}
        ${ENTRY_ORDER}
        limit 10`,
      [ctx.spaceId, id],
    );
    return { entries: rows.slice(0, l), opening, hasMore: rows.length > l };
  });
}

/** `limit` entri hidup terbaru ruang ini (1–100). */
export async function recentEntries(ctx: LedgerCtx, n: number): Promise<EntryVM[]> {
  const l = limit.parse(n);
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, (c) =>
    queryEntries(
      c,
      `select ${ENTRY_COLUMNS}
         from app.entries e ${ENTRY_JOINS}
        where e.space_id = $1 and e.voided_at is null
        ${ENTRY_ORDER}
        limit $2`,
      [ctx.spaceId, l],
    ),
  );
}

interface HistoryRow {
  version: number;
  op: HistoryVM['op'];
  at: string;
  changed_by: string;
  changed_by_name: string | null;
  amount: number | null;
}

/**
 * Satu entri ruang ini, termasuk yang dibatalkan, dengan riwayat urut versi (lama → baru).
 * `null` bila id bukan uuid, tidak ada, atau milik ruang lain (disamakan).
 */
export async function getEntry(
  ctx: LedgerCtx,
  entryId: string,
): Promise<{ entry: EntryVM; history: HistoryVM[] } | null> {
  const parsed = uuid.safeParse(entryId);
  if (!parsed.success) return null;
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const [entry] = await queryEntries(
      c,
      `select ${ENTRY_COLUMNS}
         from app.entries e ${ENTRY_JOINS}
        where e.space_id = $1 and e.id = $2`,
      [ctx.spaceId, parsed.data],
    );
    if (!entry) return null;
    const { rows } = await c.query<HistoryRow>(
      `select h.version, h.op::text as op, ${wib('h.changed_at')} as at, h.changed_by,
              r.display_name as changed_by_name,
              (select abs((l ->> 'amount')::bigint)
                 from jsonb_array_elements(h.snapshot -> 'lines') l
                where l ->> 'role' = 'main') as amount
         from app.entry_history h
         left join app.space_roster($1) r on r.user_id = h.changed_by
        where h.space_id = $1 and h.entry_id = $2
        order by h.version`,
      [ctx.spaceId, parsed.data],
    );
    const history = rows.map((row): HistoryVM => {
      const by = person(row.changed_by, row.changed_by_name);
      const vm: HistoryVM = {
        version: row.version,
        op: row.op,
        at: row.at,
        by: { name: by.name, initial: initialOf(by.name) },
        changedBy: row.changed_by,
      };
      if (row.amount !== null) vm.amount = row.amount;
      return vm;
    });
    return { entry, history };
  });
}

/** Sampah: `api.trash_list(p_limit => 100)` (batal ≤ 90 hari, terbaru dulu) + bentuk entri. */
export async function trashList(ctx: LedgerCtx): Promise<TrashVM[]> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<EntryRow & { purge_after: string }>(
      `select ${ENTRY_COLUMNS}, ${wib('t.purge_after')} as purge_after
         from api.trash_list(p_space_id => $1, p_limit => 100) with ordinality
              as t (entry_id, version, kind, direction, occurred_on, description, amount,
                    voided_at, voided_by, purge_after, n)
         join app.entries e on e.space_id = $1 and e.id = t.entry_id
         ${ENTRY_JOINS}
        order by t.n`,
      [ctx.spaceId],
    );
    return rows.map((row) => ({ entry: toEntryVM(row), purgeAfter: row.purge_after }));
  });
}

// ===== Dompet dan kategori =====
interface AccountRow {
  id: string;
  name: string;
  pocket: Pocket;
  wallet_type: WalletType;
  opened_on: string;
  archived: boolean;
  balance: number;
}

/**
 * Dompet ruang ini dengan saldo (`app.account_balances`). Dompet terarsip disembunyikan kecuali
 * saldonya ≠ 0 (tidak mungkin: `api.archive_account` mewajibkan saldo 0, BSD §2.2 butir 4).
 */
export async function listAccounts(ctx: LedgerCtx): Promise<AccountVM[]> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<AccountRow>(
      `select a.id, a.name, a.pocket::text as pocket, a.wallet_type::text as wallet_type,
              a.opened_on, a.archived_at is not null as archived, b.balance
         from app.accounts a
         join app.account_balances b on b.space_id = a.space_id and b.account_id = a.id
        where a.space_id = $1 and (a.archived_at is null or b.balance <> 0)
        order by a.sort_order, a.created_at, a.id`,
      [ctx.spaceId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      pocket: r.pocket,
      walletType: r.wallet_type,
      openedOn: r.opened_on,
      archived: r.archived,
      balance: r.balance,
    }));
  });
}

interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  type: 'income' | 'expense';
  icon: string;
  archived: boolean;
}

/** Kategori ruang ini: kategori awal dulu (urutan seed), lalu buatan pengguna (urut dibuat). */
export async function listCategories(
  ctx: LedgerCtx,
  opts: { includeArchived?: boolean } = {},
): Promise<CategoryVM[]> {
  const includeArchived = opts.includeArchived === true;
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<CategoryRow>(
      `select c.id, c.parent_id, c.name, c.type::text as type, c.icon,
              c.archived_at is not null as archived
         from app.categories c
        where c.space_id = $1 and ($2::boolean or c.archived_at is null)
        order by c.is_system desc, c.sort_order, c.created_at, c.id`,
      [ctx.spaceId, includeArchived],
    );
    return rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      name: r.name,
      type: r.type,
      icon: r.icon,
      archived: r.archived,
    }));
  });
}

/** Id kategori saran (urutan `api.suggest_categories`, 6 teratas); jam kosong = jam WIB DB. */
export async function suggestCategories(
  ctx: LedgerCtx,
  i: {
    type: 'income' | 'expense';
    hour?: number | undefined;
    amount?: Rupiah | undefined;
    description?: string | undefined;
  },
): Promise<string[]> {
  const v = suggestSchema.parse(i);
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<{ category_id: string }>(
      `select s.category_id
         from api.suggest_categories(
                p_space_id => $1, p_type => $2::app.category_type, p_hour => $3::smallint,
                p_amount => $4::bigint, p_description => $5)
              with ordinality as s (category_id, score, source, n)
        order by s.n`,
      [ctx.spaceId, v.type, v.hour ?? null, v.amount ?? null, v.description ?? null],
    );
    return rows.map((r) => r.category_id);
  });
}

// ===== Ringkasan =====
/** `api.month_summary` untuk bulan `YYYY-MM` (kolom kantor tidak dipakai VM). */
export async function monthSummary(ctx: LedgerCtx, m: string): Promise<MonthSummaryVM> {
  const first = `${month.parse(m)}-01`;
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<{
      pemasukan: number;
      pengeluaran: number;
      selisih: number;
      transfer: number;
    }>(
      `select s.pemasukan, s.pengeluaran, s.selisih, s.transfer
         from api.month_summary(p_space_id => $1, p_month => $2::date) s`,
      [ctx.spaceId, first],
    );
    const r = rows[0];
    if (!r) throw new Error('month_summary kosong');
    return {
      pemasukan: r.pemasukan,
      pengeluaran: r.pengeluaran,
      selisih: r.selisih,
      transfer: r.transfer,
    };
  });
}

/** `api.safe_to_spend` dengan hari ini = `app.today()` (p_today kosong). */
export async function safeToSpend(ctx: LedgerCtx): Promise<SafeToSpendVM> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<{
      operasional: number;
      bills_until_eom: number;
      budget_wajib_remaining: number;
      total: number;
    }>(
      `select s.operasional, s.bills_until_eom, s.budget_wajib_remaining, s.total
         from api.safe_to_spend(p_space_id => $1) s`,
      [ctx.spaceId],
    );
    const r = rows[0];
    if (!r) throw new Error('safe_to_spend kosong');
    return {
      operasional: r.operasional,
      billsUntilEom: r.bills_until_eom,
      budgetWajibRemaining: r.budget_wajib_remaining,
      aman: r.total,
    };
  });
}

/**
 * Status hari ini (WIB server): ada pengeluaran hidup ruang ini dengan `occurred_on = app.today()`,
 * dan apakah hari ini ditandai tanpa pengeluaran. Hanya `expense` yang dihitung (ruling review
 * akhir S6): pemasukan, transfer, antar ruang, saldo awal, dan cocokkan saldo tidak menyembunyikan
 * tombol "Tidak ada pengeluaran hari ini". Baris `no_spend_days` tidak pernah dihapus; UI yang
 * menyembunyikan status tanda bila ada pengeluaran.
 */
export async function todayStatus(ctx: LedgerCtx): Promise<TodayStatusVM> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<{ has_expense: boolean; no_spend: boolean }>(
      `select exists (select 1 from app.entries e
                       where e.space_id = $1 and e.voided_at is null
                         and e.occurred_on = app.today()
                         and e.kind = 'expense')
                as has_expense,
              exists (select 1 from app.no_spend_days d
                       where d.space_id = $1 and d.on_date = app.today()) as no_spend`,
      [ctx.spaceId],
    );
    const r = rows[0];
    return { hasExpense: r?.has_expense === true, noSpendMarked: r?.no_spend === true };
  });
}

/**
 * Ada pengeluaran hidup di ruang ini (checklist Beranda "Catat satu pengeluaran"), kapan pun.
 * Bukan fungsi SQL baru: satu `exists` dengan `space_id` eksplisit.
 */
export async function hasExpense(ctx: LedgerCtx): Promise<boolean> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<{ any: boolean }>(
      `select exists (select 1 from app.entries e
                       where e.space_id = $1 and e.voided_at is null and e.kind = 'expense')
                as any`,
      [ctx.spaceId],
    );
    return rows[0]?.any === true;
  });
}
