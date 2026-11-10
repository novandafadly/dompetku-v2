import 'server-only';
import { createHash } from 'node:crypto';
import { formatRupiah, type Rupiah } from '@dompetku/domain';
import { ZodError } from 'zod';
import { withAnon, withUser, type Pools } from '../db';
import { toLedgerError } from '../ledger/errors';
import { getEntry } from '../ledger/read';
import { withLedger } from '../ledger/retry';
import { resolveSpace, SpaceNotFoundError } from '../ledger/space';
import { createEntry, voidEntry, type LedgerCtx } from '../ledger/write';
import type { WaEnv } from './config';
import { parseMessage, type ParseResult } from './parse';
import { toE164 } from './phone';
import { createLinkLimiter, createRateLimiter, type RateLimiter } from './ratelimit';
import type { InboundMessage, WaTransport } from './transport';
import { uuidV5 } from './uuid';

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

/** Balasan satu baris (spec 4.2). ✅/❌/↩️/⚠️ persis spec; sisanya salinan task ini. */
export const REPLY = {
  recorded: (category: string, amount: Rupiah, space: SpaceKind) =>
    `✅ ${category} ${formatRupiah(amount)} · ${RUANG_LABEL[space]} · ketik batal untuk membatalkan`,
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
  insufficient: '❌ Saldo dompet tidak cukup. Catat dari app.',
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
  select s.category_id, c.name, api.wa_default_account(p_space_id => $1) as account_id
    from s
    join app.categories c on c.id = s.category_id
    left join base on base.category_id = s.category_id
   order by (s.score > coalesce(base.score, -1)) desc, s.n
   limit 1`;

interface Pick {
  accountId: string | null;
  categoryId: string | null;
  categoryName: string | null;
}

async function pick(
  ctx: LedgerCtx,
  type: 'income' | 'expense',
  amount: Rupiah,
  description: string,
): Promise<Pick> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<{
      category_id: string;
      name: string;
      account_id: string | null;
    }>(PICK_SQL, [ctx.spaceId, type, amount, description === '' ? null : description]);
    const row = rows[0];
    if (row)
      return { accountId: row.account_id, categoryId: row.category_id, categoryName: row.name };
    const acc = await c.query<{ id: string | null }>(
      'select api.wa_default_account(p_space_id => $1) as id',
      [ctx.spaceId],
    );
    return { accountId: acc.rows[0]?.id ?? null, categoryId: null, categoryName: null };
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
  p: { type: 'income' | 'expense'; amount: Rupiah; space: SpaceKind; description: string },
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
  const chosen = await pick(ctx, p.type, p.amount, p.description);
  if (chosen.accountId === null || chosen.categoryId === null || chosen.categoryName === null) {
    await finish(r, userId, 'rejected');
    r.log('rejected', chosen.accountId === null ? 'no_wallet' : 'no_category');
    await reply(r, chosen.accountId === null ? REPLY.noWallet(p.space) : REPLY.noCategory(p.space));
    return;
  }

  let entryId: string;
  try {
    ({ entryId } = await createEntry(ctx, {
      clientId: uuidV5(WA_CLIENT_NAMESPACE, r.key),
      accountId: chosen.accountId,
      kind: p.type,
      amount: p.amount,
      categoryId: chosen.categoryId,
      description: p.description === '' ? undefined : p.description,
    }));
  } catch (e) {
    const code = finalRejection(e);
    if (code === null) throw e;
    await finish(r, userId, 'rejected');
    r.log('rejected', code);
    await reply(r, code === 'saldo_negatif' ? REPLY.insufficient : REPLY.notRecorded);
    return;
  }
  // Entri sudah tersimpan: balasan ✅ walau finish gagal (kirim ulang id sama = replayed).
  await finish(r, userId, 'recorded', entryId);
  r.log('recorded');
  await reply(r, REPLY.recorded(chosen.categoryName, p.amount, p.space));
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
    const { rows } = await c.query<{ r: unknown }>('select api.wa_last_cancellable() as r');
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
      await reply(r, parsed.reason === 'too_large' ? REPLY.tooLarge : REPLY.unreadable);
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
