import 'server-only';
import { createHash } from 'node:crypto';
import { dayLabel, formatRupiah, type IsoDate, type Rupiah } from '@dompetku/domain';
import { ZodError } from 'zod';
import { withAnon, withUser, type Pools } from '../db';
import { toLedgerError } from '../ledger/errors';
import { getEntry } from '../ledger/read';
import { withLedger } from '../ledger/retry';
import { resolveSpace, SpaceNotFoundError } from '../ledger/space';
import { createEntry, voidEntry, type LedgerCtx } from '../ledger/write';
import type { WaEnv } from './config';
import { resolveDate } from './date';
import { parseMessage, type DateSpec, type ParseResult } from './parse';
import { toE164 } from './phone';
import { createLinkLimiter, createRateLimiter, type RateLimiter } from './ratelimit';
import type { InboundMessage, WaTransport } from './transport';
import { uuidV5 } from './uuid';
import { matchWallet, walletHandle, type WalletOption } from './wallet';

/**
 * Orkestrasi satu pesan WhatsApp masuk (spec 2026-11-09 §4, §5.2, §5.3). Urutan:
 * filter pesan pribadi → nomor E.164 → batas laju per nomor (sebelum lookup, nomor asing ikut
 * dibatasi) → `api.wa_resolve_sender` → `parseMessage` → (`hubung`: batas percobaan lalu
 * `api.wa_confirm_link`) → `api.wa_claim_message` (dedupe; sudah ada = diam) → catat/batal lewat
 * `createEntry`/`voidEntry` → `api.wa_finish_message` → balasan.
 *
 * Privasi: id pesan OpenWA bisa memuat nomor, jadi yang masuk DB hanya SHA-256-nya. Log hanya
 * menerima kode mesin (`WaLogEvent` + SQLSTATE/errno), tidak pernah teks, nominal, nomor, atau id.
 * `handleInbound` tidak pernah melempar; balasan best-effort (gagal kirim tidak membatalkan
 * catatan).
 */

/** Namespace UUID v5 tetap untuk `clientId` entri dari WhatsApp. Jangan diubah (idempotensi). */
export const WA_CLIENT_NAMESPACE = '2097b364-902f-4e68-b594-cb9e73bc3a79';

const MINUTE = 60_000;
const HOUR = 3_600_000;

const RUANG_LABEL = { personal: 'Pribadi', shared: 'Bersama' } as const;
type SpaceKind = keyof typeof RUANG_LABEL;

const WALLET_LIST_MAX = 12;

/** " Pilih: @bca, @cimb" (dipotong di 12 nama); kosong bila tidak ada penanda yang bisa dibentuk. */
function walletList(options: readonly string[]): string {
  if (options.length === 0) return '';
  const shown = options.slice(0, WALLET_LIST_MAX).join(', ');
  return ` Pilih: ${shown}${options.length > WALLET_LIST_MAX ? ', …' : ''}`;
}

/** Balasan satu baris (spec 4.2). ✅/❌/↩️/⚠️ persis spec; sisanya salinan task ini. */
export const REPLY = {
  /** Pemasukan diberi label agar salah baca jenis (mis. kata `masuk` di keterangan) terlihat. */
  recorded: (
    type: 'income' | 'expense',
    category: string,
    amount: Rupiah,
    space: SpaceKind,
    wallet: string,
    /** Label tanggal (`dayLabel`) hanya bila bukan hari ini, supaya salah baca tanggal terlihat. */
    date?: string,
  ) =>
    `✅ ${type === 'income' ? 'Pemasukan · ' : ''}${category} ${formatRupiah(amount)} · ${RUANG_LABEL[space]} · ${wallet}${date === undefined ? '' : ` · ${date}`} · ketik batal untuk membatalkan`,
  cancelled: (category: string, amount: Rupiah) =>
    `↩️ Dibatalkan: ${category} ${formatRupiah(amount)}`,
  unreadable: '❌ Tidak terbaca. Contoh: 25rb makan siang',
  failed: '⚠️ Gagal menyimpan, coba lagi sebentar lagi',
  tooLarge: '❌ Nominal terlalu besar untuk WhatsApp. Gunakan app.',
  cancelUnavailable: '❌ Tidak bisa dibatalkan dari WhatsApp. Buka app.',
  noWallet: (space: SpaceKind) =>
    `❌ Belum ada dompet aktif di ruang ${RUANG_LABEL[space]}. Buka app dulu.`,
  noCategory: (space: SpaceKind) =>
    `❌ Belum ada kategori aktif di ruang ${RUANG_LABEL[space]}. Buka app dulu.`,
  noSpace: (space: SpaceKind) => `❌ Ruang ${RUANG_LABEL[space]} belum tersedia. Buka app dulu.`,
  insufficient: (wallet: string) => `❌ Saldo ${wallet} tidak cukup. Catat dari app.`,
  /** Penanda `@nama` rusak atau lebih dari satu: tidak ada yang dicatat. */
  badDate: '❌ Tanggal tidak terbaca. Contoh: 25rb makan kemarin, atau 25rb makan tgl 9/11',
  manyDates: '❌ Satu pesan satu tanggal. Contoh: 25rb makan kemarin',
  futureDate: '❌ Tanggal belum terjadi. Contoh: 25rb makan kemarin',
  beforeOpening: (wallet: string) => `❌ Tanggal itu sebelum ${wallet} dibuka. Catat dari app.`,
  badWallet: '❌ Penanda dompet tidak terbaca. Contoh: 25rb makan siang @cimb',
  manyWallets: '❌ Satu pesan satu dompet. Contoh: 25rb makan siang @cimb',
  /** Gagal tertutup: dompet tidak ditebak. Daftar = penanda siap ketik semua dompet aktif ruang itu. */
  walletNone: (marker: string, space: SpaceKind, options: readonly string[]) =>
    `❌ Dompet @${marker} tidak ada di ruang ${RUANG_LABEL[space]}.${walletList(options)}`,
  walletAmbiguous: (marker: string, space: SpaceKind, options: readonly string[]) =>
    `❌ @${marker} cocok dengan lebih dari satu dompet di ruang ${RUANG_LABEL[space]}. Tulis lebih lengkap.${walletList(options)}`,
  notRecorded: '❌ Tidak bisa dicatat dari WhatsApp. Buka app.',
  unlinked:
    'Nomor ini belum terhubung ke DompetKu. Buka menu WhatsApp di app untuk membuat kode, lalu kirim: hubung KODE',
  linked: '✅ Nomor terhubung. Contoh: 25rb makan siang',
  /** Kode salah, kedaluwarsa, nomor milik akun lain, atau batas percobaan: satu teks yang sama. */
  linkFailed: '❌ Kode tidak berlaku. Buat kode baru di app.',
} as const;

export type WaLogEvent =
  | 'ignored'
  | 'no_phone'
  | 'rate_limited'
  | 'unlinked'
  | 'unlinked_quiet'
  | 'link_limited'
  | 'linked'
  | 'link_failed'
  | 'duplicate'
  | 'recorded'
  | 'rejected'
  | 'cancelled'
  | 'cancel_unavailable'
  | 'db_error'
  | 'save_failed'
  | 'finish_failed'
  | 'reply_failed'
  | 'internal_error';

/** `code` = SQLSTATE, errno, kode domain mesin, atau alasan parser; tidak pernah isi pesan. */
export type WaLog = (event: WaLogEvent, code?: string) => void;

export interface WaDeps {
  pools: Pools;
  transport: WaTransport;
  env: WaEnv;
  /** Per nomor E.164, `env.ratePerMin` per menit. */
  limiter: RateLimiter;
  /** Percobaan `hubung`: 5/jam per nomor, 30/jam global (`createLinkLimiter`). */
  linkLimiter: RateLimiter;
  /** Petunjuk "belum terhubung": maksimum sekali per jam per nomor. */
  hintLimiter: RateLimiter;
  /** Bawaan: `console.warn('[wa] …')`. */
  log?: WaLog;
}

/** Deps untuk satu proses web (batas laju dalam memori). `now` hanya untuk tes. */
export function createWaDeps(
  pools: Pools,
  transport: WaTransport,
  env: WaEnv,
  now: () => number = Date.now,
): WaDeps {
  return {
    pools,
    transport,
    env,
    limiter: createRateLimiter(env.ratePerMin, MINUTE, now),
    linkLimiter: createLinkLimiter(now),
    hintLimiter: createRateLimiter(1, HOUR, now),
  };
}

const defaultLog: WaLog = (event, code) => {
  console.warn(code === undefined ? `[wa] ${event}` : `[wa] ${event} ${code}`);
};

const SAFE_CODE = /^[A-Za-z0-9_]{1,32}$/;

/** Kode galat aman untuk log: `code` pg/errno bila berbentuk kode mesin, selain itu nama kelas. */
function errCode(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && SAFE_CODE.test(code)) return code;
    if (e instanceof ZodError) return 'zod';
  }
  return 'unknown';
}

function messageKey(messageId: string): string {
  return createHash('sha256').update(messageId, 'utf8').digest('hex');
}

interface Run {
  deps: WaDeps;
  log: WaLog;
  phone: string;
  key: string;
}

async function reply(r: Run, text: string): Promise<void> {
  try {
    await r.deps.transport.sendText(r.phone, text);
  } catch (e) {
    r.log('reply_failed', errCode(e));
  }
}

// ===== DB (fungsi api.wa_*, migrasi 0123) =====
async function resolveSender(pools: Pools, phone: string): Promise<string | null> {
  return withAnon(pools.app, async (c) => {
    const { rows } = await c.query<{ r: string | null }>(
      'select api.wa_resolve_sender(p_phone => $1) as r',
      [phone],
    );
    return rows[0]?.r ?? null;
  });
}

async function confirmLink(pools: Pools, code: string, phone: string): Promise<string | null> {
  return withAnon(pools.app, async (c) => {
    const { rows } = await c.query<{ r: string | null }>(
      'select api.wa_confirm_link(p_code => $1, p_phone => $2) as r',
      [code, phone],
    );
    return rows[0]?.r ?? null;
  });
}

async function claim(pools: Pools, userId: string, key: string): Promise<boolean> {
  return withUser(pools.app, userId, async (c) => {
    const { rows } = await c.query<{ r: boolean }>(
      'select api.wa_claim_message(p_message_id => $1) as r',
      [key],
    );
    return rows[0]?.r === true;
  });
}

type FinishStatus = 'recorded' | 'rejected' | 'cancelled' | 'ignored';

/** Best-effort: gagal = log, klaim tetap `pending` (dipulihkan klaim ulang sesudah 30 detik). */
async function finish(
  r: Run,
  userId: string,
  status: FinishStatus,
  entryId: string | null = null,
): Promise<void> {
  try {
    await withUser(r.deps.pools.app, userId, (c) =>
      c.query(
        'select api.wa_finish_message(p_message_id => $1, p_status => $2, p_entry_id => $3)',
        [r.key, status, entryId],
      ),
    );
  } catch (e) {
    r.log('finish_failed', errCode(e));
  }
}

/**
 * Kategori pesan: kategori yang cocok kamus kata kunci (`app.category_keywords`, lewat
 * `api.suggest_categories`) didahulukan, diurutkan skor saran; tanpa kecocokan kamus = saran
 * teratas (riwayat 30 hari, lalu nama). Kecocokan kamus dikenali sebagai skor yang naik saat
 * keterangan diberikan (bonus kamus 0107), sehingga aturan pencocokan tetap satu sumber di DB.
 */
const PICK_SQL = `
  with s as (
    select t.category_id, t.score, t.n
      from api.suggest_categories(
             p_space_id => $1, p_type => $2::app.category_type, p_amount => $3::bigint,
             p_description => $4, p_limit => 20)
           with ordinality as t (category_id, score, source, n)
  ), base as (
    select b.category_id, b.score
      from api.suggest_categories(
             p_space_id => $1, p_type => $2::app.category_type, p_amount => $3::bigint,
             p_description => null, p_limit => 20) as b (category_id, score, source)
  )
  select s.category_id, c.name
    from s
    join app.categories c on c.id = s.category_id
    left join base on base.category_id = s.category_id
   order by (s.score > coalesce(base.score, -1)) desc, s.n
   limit 1`;

/**
 * Dompet bawaan ruang untuk user (`api.wa_default_account`, tidak pernah `kantor`) beserta namanya,
 * untuk balasan. INVOKER: di luar keanggotaan RLS menyembunyikan baris -> kosong.
 */
const DEFAULT_ACCOUNT_SQL = `
  select a.id, a.name
    from app.accounts a
   where a.id = (select api.wa_default_account(p_space_id => $1))`;

/**
 * Dompet aktif ruang itu (RLS: hanya ruang anggota), untuk mencocokkan penanda `@nama`. Kantong
 * `kantor` ikut: hanya pilihan eksplisit yang boleh mencatat ke sana, bawaan tidak pernah.
 */
const ACCOUNTS_SQL = `
  select a.id, a.name, a.pocket::text as pocket
    from app.accounts a
   where a.space_id = $1 and a.archived_at is null
   order by a.sort_order, a.created_at, a.id`;

interface Pick {
  account: { id: string; name: string } | null;
  categoryId: string | null;
  categoryName: string | null;
  /** Penanda `@nama` yang tidak bisa dipakai; `options` = penanda siap ketik semua dompet aktif. */
  walletError: { kind: 'none' | 'ambiguous'; options: string[] } | null;
}

/** Penanda untuk daftar balasan: dompet tanpa penanda yang bisa dibentuk dilewati. */
function handles(accounts: readonly WalletOption[]): string[] {
  return accounts.flatMap((a) => walletHandle(a.name) ?? []);
}

/** Hari ini menurut DB (`app.today()`, WIB): satu sumber dengan penolakan tanggal masa depan ledger. */
async function dbToday(ctx: LedgerCtx): Promise<IsoDate> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<{ d: string }>('select app.today()::text as d');
    const d = rows[0]?.d;
    if (d === undefined) throw new Error('app.today kosong');
    return d;
  });
}

async function pick(
  ctx: LedgerCtx,
  type: 'income' | 'expense',
  amount: Rupiah,
  description: string,
  wallet: string | undefined,
): Promise<Pick> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    let account: Pick['account'];
    if (wallet === undefined) {
      const def = await c.query<{ id: string; name: string }>(DEFAULT_ACCOUNT_SQL, [ctx.spaceId]);
      account = def.rows[0] ?? null;
    } else {
      const { rows } = await c.query<WalletOption>(ACCOUNTS_SQL, [ctx.spaceId]);
      const m = matchWallet(wallet, rows);
      if (m.kind !== 'found') {
        return {
          account: null,
          categoryId: null,
          categoryName: null,
          walletError: { kind: m.kind, options: handles(rows) },
        };
      }
      account = { id: m.wallet.id, name: m.wallet.name };
    }
    const cat = await c.query<{ category_id: string; name: string }>(PICK_SQL, [
      ctx.spaceId,
      type,
      amount,
      description === '' ? null : description,
    ]);
    const row = cat.rows[0];
    return {
      account,
      categoryId: row?.category_id ?? null,
      categoryName: row?.name ?? null,
      walletError: null,
    };
  });
}

/**
 * Galat tulis: `null` = sementara (jaringan, 40001/40P01 yang habis diulang, bug tak dikenal), klaim
 * dibiarkan pending dan pemanggil melempar; selain itu kode domain untuk penolakan final.
 */
function finalRejection(e: unknown): string | null {
  if (e instanceof ZodError) return 'invalid';
  const le = toLedgerError(e);
  return le === null || le.code === 'network' ? null : le.code;
}

// ===== Alur =====
async function record(
  r: Run,
  userId: string,
  p: {
    type: 'income' | 'expense';
    amount: Rupiah;
    space: SpaceKind;
    description: string;
    wallet?: string;
    date?: DateSpec;
  },
): Promise<void> {
  const { pools } = r.deps;
  let spaceId: string;
  try {
    spaceId = (await resolveSpace(pools, userId, p.space === 'shared' ? 'bersama' : 'pribadi'))
      .spaceId;
  } catch (e) {
    if (!(e instanceof SpaceNotFoundError)) throw e;
    await finish(r, userId, 'rejected');
    r.log('rejected', 'no_space');
    await reply(r, REPLY.noSpace(p.space));
    return;
  }
  const ctx: LedgerCtx = { pools, userId, spaceId };

  // Tanggal dipadukan dengan hari ini DB sebelum dompet/kategori; masa depan ditolak di sini
  // dengan teks sendiri (ledger menolaknya juga, sebagai `invalid`).
  let occurredOn: IsoDate | undefined;
  let dateLabel: string | undefined;
  if (p.date !== undefined) {
    const today = await dbToday(ctx);
    const res = resolveDate(p.date, today);
    if (!res.ok) {
      await finish(r, userId, 'rejected');
      r.log('rejected', res.reason === 'future' ? 'date_future' : 'date_invalid');
      await reply(r, res.reason === 'future' ? REPLY.futureDate : REPLY.badDate);
      return;
    }
    if (res.iso !== today) {
      occurredOn = res.iso;
      dateLabel = dayLabel(res.iso, today);
    }
  }

  const chosen = await pick(ctx, p.type, p.amount, p.description, p.wallet);
  if (chosen.walletError !== null && p.wallet !== undefined) {
    const { kind, options } = chosen.walletError;
    await finish(r, userId, 'rejected');
    r.log('rejected', kind === 'none' ? 'wallet_none' : 'wallet_ambiguous');
    await reply(
      r,
      kind === 'none'
        ? REPLY.walletNone(p.wallet, p.space, options)
        : REPLY.walletAmbiguous(p.wallet, p.space, options),
    );
    return;
  }
  if (chosen.account === null || chosen.categoryId === null || chosen.categoryName === null) {
    await finish(r, userId, 'rejected');
    r.log('rejected', chosen.account === null ? 'no_wallet' : 'no_category');
    await reply(r, chosen.account === null ? REPLY.noWallet(p.space) : REPLY.noCategory(p.space));
    return;
  }
  const account = chosen.account;

  let entryId: string;
  try {
    ({ entryId } = await createEntry(ctx, {
      clientId: uuidV5(WA_CLIENT_NAMESPACE, r.key),
      accountId: account.id,
      kind: p.type,
      amount: p.amount,
      categoryId: chosen.categoryId,
      occurredOn,
      description: p.description === '' ? undefined : p.description,
    }));
  } catch (e) {
    const code = finalRejection(e);
    if (code === null) throw e;
    await finish(r, userId, 'rejected');
    r.log('rejected', code);
    await reply(
      r,
      code === 'saldo_negatif'
        ? REPLY.insufficient(account.name)
        : code === 'before_opening'
          ? REPLY.beforeOpening(account.name)
          : REPLY.notRecorded,
    );
    return;
  }
  // Entri sudah tersimpan: balasan ✅ walau finish gagal (kirim ulang id sama = replayed).
  await finish(r, userId, 'recorded', entryId);
  r.log('recorded');
  await reply(
    r,
    REPLY.recorded(p.type, chosen.categoryName, p.amount, p.space, account.name, dateLabel),
  );
}

const lastSchema = (v: unknown): { entryId: string; spaceId: string; version: number } | null => {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { entry_id?: unknown; space_id?: unknown; version?: unknown };
  if (typeof o.entry_id !== 'string' || typeof o.space_id !== 'string') return null;
  if (typeof o.version !== 'number' || !Number.isSafeInteger(o.version)) return null;
  return { entryId: o.entry_id, spaceId: o.space_id, version: o.version };
};

async function cancel(r: Run, userId: string): Promise<void> {
  const { pools } = r.deps;
  const last = await withUser(pools.app, userId, async (c) => {
    // p_current: pesan `batal` ini sendiri (sudah diklaim pending) tidak dihitung; pesan lain yang
    // masih pending menghalangi batal agar tidak mengenai catatan yang lebih lama.
    const { rows } = await c.query<{ r: unknown }>(
      'select api.wa_last_cancellable(p_current => $1) as r',
      [r.key],
    );
    return lastSchema(rows[0]?.r ?? null);
  });
  const unavailable = async (code: string) => {
    await finish(r, userId, 'rejected');
    r.log('cancel_unavailable', code);
    await reply(r, REPLY.cancelUnavailable);
  };
  if (last === null) {
    await unavailable('none');
    return;
  }

  const ctx: LedgerCtx = { pools, userId, spaceId: last.spaceId };
  const found = await getEntry(ctx, last.entryId);
  if (found === null) {
    await unavailable('not_found');
    return;
  }
  try {
    await voidEntry(ctx, {
      clientId: uuidV5(WA_CLIENT_NAMESPACE, r.key),
      entryId: last.entryId,
      expectedVersion: last.version,
    });
  } catch (e) {
    const code = finalRejection(e);
    if (code === null) throw e;
    await unavailable(code);
    return;
  }
  await finish(r, userId, 'cancelled', last.entryId);
  r.log('cancelled');
  await reply(r, REPLY.cancelled(found.entry.categoryName ?? 'Tanpa kategori', found.entry.amount));
}

/**
 * `hubung KODE`. `userId` = pengirim yang sudah terhubung (klaim sudah diambil) atau null. Batas
 * percobaan ditolak dengan balasan yang sama dengan kode salah, tanpa menyentuh DB.
 */
async function link(r: Run, userId: string | null, code: string): Promise<void> {
  if (!r.deps.linkLimiter.allow(r.phone)) {
    if (userId) await finish(r, userId, 'rejected');
    r.log('link_limited');
    await reply(r, REPLY.linkFailed);
    return;
  }
  const linked = await confirmLink(r.deps.pools, code, r.phone);
  if (linked === null) {
    if (userId) await finish(r, userId, 'rejected');
    r.log('link_failed');
    await reply(r, REPLY.linkFailed);
    return;
  }
  // Pesan ini dicatat atas user yang baru terhubung: kiriman ulang webhook jadi duplikat (diam).
  try {
    if (userId !== linked && !(await claim(r.deps.pools, linked, r.key))) {
      r.log('duplicate');
    }
  } catch (e) {
    r.log('db_error', errCode(e));
  }
  await finish(r, linked, 'ignored');
  r.log('linked');
  await reply(r, REPLY.linked);
}

function rejectReply(reason: Extract<ParseResult, { kind: 'reject' }>['reason']): string {
  switch (reason) {
    case 'too_large':
      return REPLY.tooLarge;
    case 'many_wallets':
      return REPLY.manyWallets;
    case 'bad_wallet':
      return REPLY.badWallet;
    case 'many_dates':
      return REPLY.manyDates;
    case 'bad_date':
      return REPLY.badDate;
    default:
      return REPLY.unreadable;
  }
}

async function dispatch(r: Run, userId: string, parsed: ParseResult): Promise<void> {
  switch (parsed.kind) {
    case 'link':
      await link(r, userId, parsed.code);
      break;
    case 'cancel':
      await cancel(r, userId);
      break;
    case 'reject':
      await finish(r, userId, 'rejected');
      r.log('rejected', parsed.reason);
      await reply(r, rejectReply(parsed.reason));
      break;
    case 'entry':
      await record(r, userId, parsed);
      break;
  }
}

async function run(deps: WaDeps, log: WaLog, msg: InboundMessage): Promise<void> {
  if (msg.chatType !== 'private' || msg.fromMe || msg.text === null) {
    log('ignored');
    return;
  }
  const phone = toE164(msg.senderPhone ?? msg.from);
  if (phone === null) {
    log('no_phone');
    return;
  }
  if (!deps.limiter.allow(phone)) {
    log('rate_limited');
    return;
  }
  const r: Run = { deps, log, phone, key: messageKey(msg.messageId) };

  try {
    const userId = await resolveSender(deps.pools, phone);
    const parsed = parseMessage(msg.text, { maxAmount: deps.env.maxAmount });
    if (userId === null) {
      if (parsed.kind === 'link') {
        await link(r, null, parsed.code);
      } else if (deps.hintLimiter.allow(phone)) {
        log('unlinked');
        await reply(r, REPLY.unlinked);
      } else {
        log('unlinked_quiet');
      }
      return;
    }
    if (await claim(deps.pools, userId, r.key)) await dispatch(r, userId, parsed);
    else log('duplicate');
  } catch (e) {
    // DB tak terjangkau atau galat sementara: klaim (bila ada) tetap pending; kirim ulang aman.
    log(toLedgerError(e)?.code === 'network' ? 'db_error' : 'save_failed', errCode(e));
    await reply(r, REPLY.failed);
  }
}

/** Tidak pernah melempar. Galat sistem → balasan ⚠️ bila nomor diketahui; log tanpa isi pesan. */
export async function handleInbound(deps: WaDeps, msg: InboundMessage): Promise<void> {
  const log = deps.log ?? defaultLog;
  try {
    await run(deps, log, msg);
  } catch (e) {
    log('internal_error', errCode(e));
  }
}
