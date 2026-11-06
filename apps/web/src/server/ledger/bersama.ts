import 'server-only';
import type pg from 'pg';
import { z } from 'zod';
import { monthName, type IsoDate } from '@dompetku/domain';
import {
  activityText,
  amountChanged,
  type ActivityTextCtx,
} from '@/features/bersama/activity-text';
import type {
  ActivityItemVM,
  ContributionVM,
  MemberVM,
  SharedActivityRow,
} from '@/features/bersama/types';
import { buildEntryHref } from '@/features/shell/hrefs';
import { guarded } from './guarded';
import { withLedger } from './retry';
import { SpaceNotFoundError } from './space';
import type { LedgerCtx } from './write';

/**
 * Loader feed Aktivitas dan Kontribusi Bersama (S8 Task 4; bingkai S8-A1/A2/A3/K1). Bacaan murni
 * di transaksi milik pemanggil (`fooTx`, pola `read.ts`): Beranda memanggilnya di dalam
 * `withLedger` yang sama, halaman Aktivitas lewat `loadAktivitas` (satu `withLedger`).
 *
 * Batas privasi (K1, R24): hanya kolom `api.shared_activity`/`api.member_contributions` (tanpa
 * dompet, `link_id`, lines, atau snapshot), nama kategori ruang ini, dan roster. Hasil fungsi DB
 * divalidasi Zod dengan objek ketat: kolom yang tidak dikenal (mis. `account_id` yang suatu hari
 * ditambahkan ke fungsi) menolak baris itu. Baris feed yang gagal dibuang utuh dan dilog tanpa isi
 * (hanya jumlah dan kode isu Zod); Kontribusi yang gagal = galat (angka uang tidak pernah
 * dihitung sebagian).
 *
 * Kursor (R5): dibangun dari `to_char(at at time zone 'UTC', '…HH24:MI:SS.US"Z"')` di kueri yang
 * sama (teks mikrodetik), bukan dari `Date` JS (milidetik). `parseCursor` memvalidasi 6 digit
 * pecahan dan teksnya dikirim apa adanya ke `::timestamptz`.
 */

// ===== Kursor =====
export interface Cursor {
  /** `YYYY-MM-DDTHH:MM:SS.ffffffZ` (UTC, mikrodetik). */
  at: string;
  entryId: string;
  version: number;
}

const CURSOR_AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/;
const CURSOR_MAX = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION_MAX = 2_147_483_647;

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

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.at}|${c.entryId}|${String(c.version)}`, 'utf8').toString('base64url');
}

const cursorParts = z.tuple([
  z.string().refine(validInstant),
  z.string().regex(UUID),
  z
    .string()
    .regex(/^[1-9]\d{0,9}$/)
    .transform(Number)
    .refine((n) => n <= VERSION_MAX),
]);

/**
 * `?sebelum=` → kursor. Apa pun yang tidak sah (kosong, terlalu panjang, bukan base64url kanonik,
 * bagian salah) = `null` (halaman pertama), tidak pernah 404/500.
 */
export function parseCursor(sp: string | string[] | undefined): Cursor | null {
  if (typeof sp !== 'string' || sp.length === 0 || sp.length > CURSOR_MAX) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(sp)) return null;
  const parsed = cursorParts.safeParse(Buffer.from(sp, 'base64url').toString('utf8').split('|'));
  if (!parsed.success) return null;
  const [at, entryId, version] = parsed.data;
  const cursor = { at, entryId, version };
  // Hanya bentuk yang dibuat `encodeCursor` (tanpa varian padding/bit sisa).
  return encodeCursor(cursor) === sp ? cursor : null;
}

// ===== Roster =====
/** Anggota ruang: pemilik dulu, lalu urut bergabung (urutan tetap untuk kedua pembaca). */
export async function rosterTx(c: pg.PoolClient, ctx: LedgerCtx): Promise<MemberVM[]> {
  const { rows } = await c.query<{
    user_id: string;
    display_name: string;
    initial: string;
    role: 'owner' | 'member';
  }>(
    `select r.user_id, r.display_name, r.initial, m.role::text as role
       from app.space_roster($1) r
       join app.space_members m on m.space_id = $1 and m.user_id = r.user_id
      order by (m.role = 'owner') desc, m.joined_at, r.user_id`,
    [ctx.spaceId],
  );
  return rows.map((r) => ({
    id: r.user_id,
    name: r.display_name,
    initial: r.initial,
    role: r.role === 'owner' ? 'owner' : 'member',
  }));
}

/** Anggota lain (salinan `Yang kamu dan {Nama} …`); `null` bila solo. */
export function partnerOf(
  roster: MemberVM[],
  userId: string,
): { name: string; initial: string } | null {
  if (roster.length < 2) return null;
  const other = roster.find((m) => m.id !== userId);
  return other ? { name: other.name, initial: other.initial } : null;
}

// ===== Feed =====
// Id: `z.guid()` (bentuk 8-4-4-4-12 apa pun), bukan `z.uuid()` RFC ketat: kolom DB bertipe `uuid`
// sudah menjamin bentuknya, dan id tanpa bit versi/varian (impor v1, fixture) tidak boleh membuat
// baris dibuang.
const activityRow = z.strictObject({
  entry_id: z.guid(),
  version: z.number().int().min(1),
  op: z.enum(['create', 'update', 'void', 'restore']),
  kind: z.enum([
    'income',
    'expense',
    'transfer',
    'opening_balance',
    'space_transfer',
    'adjustment',
    'reimbursement',
  ]),
  direction: z.enum(['in', 'out']).nullable(),
  actor_id: z.guid(),
  at: z.date(),
  occurred_on: z.iso.date(),
  amount: z.number().int().min(0),
  before_amount: z.number().int().min(0).nullable(),
  category_id: z.guid().nullable(),
  before_category_id: z.guid().nullable(),
  description: z.string().nullable(),
  shared_note: z.string().nullable(),
  moved: z.boolean(),
  // Kolom turunan kueri loader (bukan fungsi DB).
  at_wib: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/),
  cursor_at: z.string().refine(validInstant),
});

/** Bagian kursor saja (longgar): halaman berikutnya tetap benar walau baris terakhir dibuang. */
const cursorRow = z.object({
  entry_id: z.string().regex(UUID),
  version: z.number().int().min(1).max(VERSION_MAX),
  cursor_at: z.string().refine(validInstant),
});

const ACTIVITY_SQL = `
  select a.*,
         to_char(a.at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI:SS"+07:00"') as at_wib,
         to_char(a.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at
    from api.shared_activity(p_space_id => $1, p_limit => $2::int,
                             p_before_at => $3::timestamptz, p_before_entry => $4::uuid,
                             p_before_version => $5::int) a
   order by a.at desc, a.entry_id desc, a.version desc`;

function toRow(r: z.output<typeof activityRow>): SharedActivityRow {
  return {
    entryId: r.entry_id,
    version: r.version,
    op: r.op,
    kind: r.kind,
    direction: r.direction,
    actorId: r.actor_id,
    at: r.at_wib,
    occurredOn: r.occurred_on,
    amount: r.amount,
    beforeAmount: r.before_amount,
    categoryId: r.category_id,
    beforeCategoryId: r.before_category_id,
    description: r.description,
    sharedNote: r.shared_note,
    moved: r.moved,
  };
}

/**
 * Label isu Zod yang aman dilog: kode + jalur, dan untuk kolom tak dikenal nama kuncinya (nama
 * kolom DB, bukan data pengguna). Tidak pernah memuat nilai.
 */
function issueLabel(i: z.core.$ZodIssue): string {
  const keys = i.code === 'unrecognized_keys' ? `[${i.keys.join('|')}]` : '';
  return `${i.code}:${i.path.join('.')}${keys}`;
}

function logDropped(issues: string[]): void {
  // Tanpa isi baris (nominal, keterangan, id): hanya jumlah dan kode/jalur isu Zod.
  console.error(
    `[bersama] ${String(issues.length)} baris feed tidak sah dibuang: ${[...new Set(issues)].join(', ')}`,
  );
}

/** Nama kategori ruang ini (termasuk yang diarsipkan: riwayat lama tetap bernama). */
async function categoryNamesTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { rows } = await c.query<{ id: string; name: string }>(
    'select id, name from app.categories where space_id = $1 and id = any($2::uuid[])',
    [ctx.spaceId, ids],
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

const UNKNOWN_ACTOR = { name: 'Anggota', initial: '?', role: null } as const;

export interface ActivityPage {
  items: ActivityItemVM[];
  /** Kursor halaman berikutnya (baris lebih lama); `null` bila tidak ada lagi. */
  next: Cursor | null;
}

/**
 * Satu halaman feed (`limit` 1–99; satu baris ekstra dikueri untuk `next`), terbaru di atas; `before` = baris sesudah kursor itu.
 * `roster` boleh diberikan pemanggil yang sudah memuatnya di transaksi yang sama.
 */
export async function sharedActivityTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  opts: { limit: number; before?: Cursor | null | undefined; roster?: MemberVM[] | undefined },
): Promise<ActivityPage> {
  const limit = z.number().int().min(1).max(99).parse(opts.limit);
  const before = opts.before ?? null;
  // Satu baris ekstra hanya untuk tahu ada halaman berikutnya.
  const { rows } = await c.query<Record<string, unknown>>(ACTIVITY_SQL, [
    ctx.spaceId,
    limit + 1,
    before?.at ?? null,
    before?.entryId ?? null,
    before?.version ?? null,
  ]);
  const page = rows.slice(0, limit);
  let next: Cursor | null = null;
  const last = page.at(-1);
  if (rows.length > limit && last !== undefined) {
    const k = cursorRow.parse(last);
    next = { at: k.cursor_at, entryId: k.entry_id, version: k.version };
  }

  const valid: SharedActivityRow[] = [];
  const issues: string[] = [];
  for (const raw of page) {
    const parsed = activityRow.safeParse(raw);
    if (parsed.success) valid.push(toRow(parsed.data));
    else for (const i of parsed.error.issues) issues.push(issueLabel(i));
  }
  if (issues.length > 0) logDropped(issues);
  // Semua baris halaman ditolak (mis. kolom/enum baru sesudah migrasi): galat, bukan keadaan
  // kosong palsu "Belum ada aktivitas". Beranda: kartu 'error' lewat savepoint; halaman Aktivitas:
  // ErrorState. Pesan tanpa isi baris.
  if (page.length > 0 && valid.length === 0) throw new Error('feed_rows_invalid');

  const roster = opts.roster ?? (await rosterTx(c, ctx));
  const byId = new Map(roster.map((m) => [m.id, m]));
  const catIds = new Set<string>();
  for (const r of valid) {
    if (r.categoryId !== null) catIds.add(r.categoryId);
    if (r.beforeCategoryId !== null) catIds.add(r.beforeCategoryId);
  }
  const names = await categoryNamesTx(c, ctx, [...catIds]);
  const textCtx: ActivityTextCtx = { categoryName: (id) => names.get(id) ?? null };

  const items = valid.map((r): ActivityItemVM => {
    const t = activityText(r, textCtx);
    const changed = amountChanged(r);
    const member = byId.get(r.actorId);
    const item: ActivityItemVM = {
      key: `${r.entryId}:${String(r.version)}`,
      entryId: r.entryId,
      actor: member ?? { id: r.actorId, ...UNKNOWN_ACTOR },
      at: r.at,
      text: t.text,
      change: t.change,
      backdate: t.backdate ?? null,
      amount: changed ? null : r.amount,
      beforeAmount: changed ? r.beforeAmount : null,
      moved: r.op === 'void' && r.moved,
      href: buildEntryHref('bersama', r.entryId, ''),
    };
    if (t.srText !== undefined) item.srText = t.srText;
    return item;
  });
  return { items, next };
}

// ===== Kontribusi =====
const contributionRow = z.strictObject({
  user_id: z.guid(),
  setoran: z.number().int().min(0),
  diambil: z.number().int().min(0),
  setoran_count: z.number().int().min(0),
  diambil_count: z.number().int().min(0),
});

export interface Period {
  from: IsoDate;
  to: IsoDate;
  /** Tanggal 1 bulan label periode (K10: periode gajian); kosong = bulan `from`. */
  labelMonth?: IsoDate;
}

/**
 * `api.member_contributions` per anggota roster, pemilik dulu. Periode = periode gajian berjalan
 * (K10, Beranda) atau periode yang dilihat di Laporan; label = nama bulan label periode.
 */
export async function contributionsTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  period: Period,
  roster?: MemberVM[],
): Promise<ContributionVM> {
  const members = roster ?? (await rosterTx(c, ctx));
  const { rows } = await c.query<Record<string, unknown>>(
    `select k.* from api.member_contributions(p_space_id => $1, p_from => $2::date,
                                                p_to => $3::date) k`,
    [ctx.spaceId, period.from, period.to],
  );
  const byUser = new Map(
    rows.map((raw) => {
      const r = contributionRow.parse(raw);
      return [r.user_id, r] as const;
    }),
  );
  const result = members.map((member) => {
    const r = byUser.get(member.id);
    return { member, setoran: r?.setoran ?? 0, diambil: r?.diambil ?? 0 };
  });
  return {
    period: {
      from: period.from,
      to: period.to,
      label: monthName((period.labelMonth ?? period.from).slice(0, 7)),
    },
    rows: result,
    allZero: result.every((r) => r.setoran === 0 && r.diambil === 0),
  };
}

// ===== Beranda dan halaman Aktivitas =====
export const BERANDA_ACTIVITY = 5;

export interface BersamaBerandaExtra {
  partner: { name: string; initial: string } | null;
  activity: ActivityItemVM[] | 'error' | null;
  contributions: ContributionVM | 'error' | null;
}

/**
 * Tambahan Beranda Bersama di transaksi pemanggil. Hanya ruang Bersama berisi ≥ 2 anggota yang
 * memuat feed dan Kontribusi; solo = semuanya `null` (kartu S7-B1 tetap). Kontribusi atas
 * `period` = periode gajian berjalan (K10; aturan kosong = bulan kalender).
 */
export async function bersamaBerandaTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  period: Period,
): Promise<BersamaBerandaExtra> {
  const roster = await rosterTx(c, ctx);
  if (roster.length < 2) return { partner: null, activity: null, contributions: null };
  const activity = await guarded(c, 'activity', async () => {
    const page = await sharedActivityTx(c, ctx, { limit: BERANDA_ACTIVITY, roster });
    return page.items;
  });
  const contributions = await guarded(c, 'contributions', async () =>
    contributionsTx(c, ctx, period, roster),
  );
  return { partner: partnerOf(roster, ctx.userId), activity, contributions };
}

export const AKTIVITAS_PAGE = 30;

export interface AktivitasData extends ActivityPage {
  /** Anggota lain untuk keadaan kosong; `null` = Bersama solo (feed tidak dimuat, S8-A3). */
  partner: { name: string; initial: string } | null;
}

/**
 * Halaman `/bersama/aktivitas` (K5): 30 baris per halaman, satu `withLedger`. Ruang Pribadi tidak
 * punya halaman ini (`SpaceNotFoundError` → 404). Galat dilempar ke page (ErrorState).
 */
export async function loadAktivitas(
  ctx: LedgerCtx & { kind: 'personal' | 'shared' },
  opts: { before?: Cursor | null | undefined } = {},
): Promise<AktivitasData> {
  if (ctx.kind !== 'shared') throw new SpaceNotFoundError();
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const roster = await rosterTx(c, ctx);
    if (roster.length < 2) return { items: [], next: null, partner: null };
    const page = await sharedActivityTx(c, ctx, {
      limit: AKTIVITAS_PAGE,
      before: opts.before,
      roster,
    });
    return { ...page, partner: partnerOf(roster, ctx.userId) };
  });
}
