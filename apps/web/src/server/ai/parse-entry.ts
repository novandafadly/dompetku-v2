import 'server-only';
import { addDays, type IsoDate } from '@dompetku/domain';
import { withLedger } from '@/server/ledger/retry';
import type { LedgerCtx } from '@/server/ledger/write';
import { MAX_BACK_DAYS } from '@/server/wa/date';
import { matchWallet, type WalletOption } from '@/server/wa/wallet';
import { getConfiguredProviders } from './config';
import {
  LlmProviderError,
  MAX_FREE_TEXT_LENGTH,
  type LlmParseRaw,
  type LlmProvider,
  type LlmProviderName,
} from './provider';
import { consumeAiQuotaTx, type AiQuotaConsumeResult } from './quota';
import { matchCategoryByRules, parseByRules, type RuleCategoryOption } from './rules';

/**
 * Orkestrasi Catat teks bebas (S17): aturan dulu → fallback LLM multi-penyedia (Gemini & Claude).
 *
 * Jaminan keamanan & invarian:
 * - 100% BACA-SAJA pada `app.entries` (tidak pernah auto-simpan; pengguna wajib konfirmasi di UI);
 * - B13: hanya memuat dompet aktif yang boleh dipakai Catat dan kategori aktif milik `ctx.spaceId`;
 * - ID dompet & kategori tidak pernah diambil dari LLM — selalu di-resolve ulang terhadap daftar
 *   aktif ruang aktif;
 * - kuota harian (`parse`: 15/hari/user WIB) dipotong atomik di DB hanya saat LLM benar-benar akan
 *   dipanggil; bila kuota habis, parser aturan tetap berjalan.
 */

export type ParseEntrySource = 'rules' | LlmProviderName;

export interface ParsedEntryPreview {
  type: 'income' | 'expense';
  amount: number;
  description: string;
  accountId: string | null;
  categoryId: string | null;
  occurredOn: IsoDate | null;
  source: ParseEntrySource;
  /** Diisi bila pemanggilan memakai kuota AI atau kuota habis. */
  quota?: {
    used: number;
    limit: number;
    remaining: number;
    exhausted: boolean;
  };
}

export type ParseEntryErrorCode =
  | 'empty'
  | 'no_amount'
  | 'too_large'
  | 'future_date'
  | 'too_old_date'
  | 'bad_date'
  | 'quota_exceeded'
  | 'network';

export type ParseEntryResult =
  | { ok: true; preview: ParsedEntryPreview }
  | {
      ok: false;
      code: ParseEntryErrorCode;
      quota?: { used: number; limit: number; remaining: number; exhausted: boolean };
    };

export interface ParseFreeTextOptions {
  /** Override daftar penyedia (untuk unit/integrasi test). Bawaan = `getConfiguredProviders()`. */
  providers?: readonly LlmProvider[];
}

interface SpaceParseContext {
  today: IsoDate;
  wallets: WalletOption[];
  categories: RuleCategoryOption[];
}

const MIN_LEDGER_DATE = '2000-01-01';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoCalendarDate(iso: string): boolean {
  if (!ISO_DATE_RE.test(iso)) return false;
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d;
}

/** Muat konteks minimum ruang aktif saja (B13): today WIB + nama dompet spendable + kategori aktif. */
async function loadSpaceParseContext(ctx: LedgerCtx): Promise<SpaceParseContext> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const todayRes = await c.query<{ today: IsoDate }>(
      `select to_char(app.today(), 'YYYY-MM-DD') as today`,
    );
    const today = todayRes.rows[0]?.today;
    if (!today) throw new Error('app.today kosong');

    // Hanya dompet aktif yang boleh dipakai Catat pemasukan/pengeluaran (bukan trading/aset/patungan).
    const accRes = await c.query<{ id: string; name: string; pocket: WalletOption['pocket'] }>(
      `select id, name, pocket
         from app.accounts
        where space_id = $1
          and archived_at is null
          and pocket in ('operasional', 'tabungan', 'kantor')
        order by sort_order, name`,
      [ctx.spaceId],
    );

    const catRes = await c.query<{ id: string; name: string; type: 'income' | 'expense' }>(
      `select id, name, type
         from app.categories
        where space_id = $1
          and archived_at is null
          and type in ('income', 'expense')
        order by name`,
      [ctx.spaceId],
    );

    return {
      today,
      wallets: accRes.rows,
      categories: catRes.rows,
    };
  });
}

function normKey(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Resolve nama kategori keluaran LLM secara ketat ke kategori aktif ruang aktif. */
function resolveLlmCategory(
  categoryName: string | null,
  description: string,
  type: 'income' | 'expense',
  categories: readonly RuleCategoryOption[],
): string | null {
  const pool = categories.filter((c) => c.type === type);
  if (categoryName !== null) {
    const target = normKey(categoryName);
    const exact = pool.find((c) => normKey(c.name) === target);
    if (exact) return exact.id;
  }
  return matchCategoryByRules(description, type, categories);
}

/** Resolve nama dompet keluaran LLM secara ketat ke dompet aktif ruang aktif. */
function resolveLlmWallet(
  walletName: string | null,
  wallets: readonly WalletOption[],
): string | null {
  if (walletName === null) return null;
  const m = matchWallet(walletName, wallets);
  return m.kind === 'found' ? m.wallet.id : null;
}

function validateLlmDate(
  occurredOn: IsoDate | null,
  today: IsoDate,
):
  | { ok: true; iso: IsoDate | null }
  | { ok: false; code: 'future_date' | 'too_old_date' | 'bad_date' } {
  if (occurredOn === null) return { ok: true, iso: null };
  if (!isValidIsoCalendarDate(occurredOn)) return { ok: false, code: 'bad_date' };
  if (occurredOn > today) return { ok: false, code: 'future_date' };
  if (occurredOn < MIN_LEDGER_DATE || occurredOn < addDays(today, -MAX_BACK_DAYS)) {
    return { ok: false, code: 'too_old_date' };
  }
  return { ok: true, iso: occurredOn };
}

function mapRuleReject(
  reason:
    | 'empty'
    | 'no_amount'
    | 'many_amounts'
    | 'bad_amount'
    | 'too_large'
    | 'future_date'
    | 'too_old_date'
    | 'bad_date',
): ParseEntryErrorCode {
  switch (reason) {
    case 'empty':
      return 'empty';
    case 'too_large':
      return 'too_large';
    case 'future_date':
      return 'future_date';
    case 'too_old_date':
      return 'too_old_date';
    case 'bad_date':
      return 'bad_date';
    default:
      return 'no_amount';
  }
}

function toQuotaInfo(q: AiQuotaConsumeResult) {
  return {
    used: q.used,
    limit: q.limit,
    remaining: q.remaining,
    exhausted: !q.allowed,
  };
}

/**
 * Jalankan rantai penyedia LLM berurutan (primer → cadangan, mis. Gemini → Claude).
 * Mengembalikan `null` jika penyedia menjawab valid "tidak ada nominal"; lanjut ke cadangan
 * bila penyedia primer galat (timeout/HTTP/jaringan/respons rusak).
 */
async function callProviderChain(
  providers: readonly LlmProvider[],
  req: {
    text: string;
    today: IsoDate;
    wallets: readonly string[];
    categories: readonly { name: string; type: 'income' | 'expense' }[];
  },
): Promise<{ provider: LlmProviderName; raw: LlmParseRaw | null } | null> {
  for (const provider of providers) {
    try {
      const raw = await provider.parseEntry(req);
      return { provider: provider.name, raw };
    } catch (e) {
      // Log hanya kode aman tanpa nominal, teks pengguna, atau kunci API.
      const tag =
        e instanceof LlmProviderError ? `${e.provider}:${e.code}` : `${provider.name}:err`;
      console.error('[ai parse] failover', tag);
    }
  }
  return null;
}

export async function parseFreeTextEntry(
  ctx: LedgerCtx,
  rawText: string,
  opts?: ParseFreeTextOptions,
): Promise<ParseEntryResult> {
  const text = rawText.trim().slice(0, MAX_FREE_TEXT_LENGTH);
  if (text === '') return { ok: false, code: 'empty' };

  const spaceCtx = await loadSpaceParseContext(ctx);
  const ruleResult = parseByRules({
    text,
    today: spaceCtx.today,
    wallets: spaceCtx.wallets,
    categories: spaceCtx.categories,
  });

  // 1. Aturan sukses dengan keyakinan tinggi → langsung pakai (0 kuota AI, < 1 ms).
  if (ruleResult.ok && ruleResult.confidence === 'high') {
    return {
      ok: true,
      preview: {
        ...ruleResult.entry,
        source: 'rules',
      },
    };
  }

  // 2. Penolakan keras (tanggal masa depan / terlalu besar / kosong) → jangan buang kuota AI.
  if (!ruleResult.ok && ruleResult.hardReject) {
    return { ok: false, code: mapRuleReject(ruleResult.reason) };
  }

  // 3. Cek apakah ada penyedia LLM aktif (Gemini / Claude).
  const providers = opts?.providers ?? getConfiguredProviders();
  if (providers.length === 0) {
    if (ruleResult.ok) {
      return {
        ok: true,
        preview: { ...ruleResult.entry, source: 'rules' },
      };
    }
    return { ok: false, code: mapRuleReject(ruleResult.reason) };
  }

  // 4. Potong kuota harian AI atomik di DB (15/hari/user WIB untuk fitur 'parse').
  const quota = await withLedger(ctx.pools, ctx.userId, ctx.spaceId, (c) =>
    consumeAiQuotaTx(c, 'parse'),
  );
  const quotaInfo = toQuotaInfo(quota);

  if (!quota.allowed) {
    // Kuota AI habis → parser aturan tetap jalan bila sempat menghasilkan draf.
    if (ruleResult.ok) {
      return {
        ok: true,
        preview: {
          ...ruleResult.entry,
          source: 'rules',
          quota: quotaInfo,
        },
      };
    }
    return { ok: false, code: 'quota_exceeded', quota: quotaInfo };
  }

  // 5. Panggil rantai penyedia LLM (hanya membawa konteks minimum ruang ini — B13).
  const llmOutcome = await callProviderChain(providers, {
    text,
    today: spaceCtx.today,
    wallets: spaceCtx.wallets.map((w) => w.name),
    categories: spaceCtx.categories.map((c) => ({ name: c.name, type: c.type })),
  });

  if (llmOutcome?.raw == null) {
    // LLM galat atau menjawab tidak ada nominal → kembalikan hasil aturan bila ada.
    if (ruleResult.ok) {
      return {
        ok: true,
        preview: {
          ...ruleResult.entry,
          source: 'rules',
          quota: quotaInfo,
        },
      };
    }
    return { ok: false, code: llmOutcome === null ? 'network' : 'no_amount', quota: quotaInfo };
  }

  const raw = llmOutcome.raw;
  const dateCheck = validateLlmDate(raw.occurredOn, spaceCtx.today);
  if (!dateCheck.ok) {
    return { ok: false, code: dateCheck.code, quota: quotaInfo };
  }

  const accountId =
    resolveLlmWallet(raw.walletName, spaceCtx.wallets) ??
    (ruleResult.ok ? ruleResult.entry.accountId : null);
  const categoryId =
    resolveLlmCategory(raw.categoryName, raw.description, raw.type, spaceCtx.categories) ??
    (ruleResult.ok && ruleResult.entry.type === raw.type ? ruleResult.entry.categoryId : null);

  return {
    ok: true,
    preview: {
      type: raw.type,
      amount: raw.amount,
      description: raw.description,
      accountId,
      categoryId,
      occurredOn: dateCheck.iso,
      source: llmOutcome.provider,
      quota: quotaInfo,
    },
  };
}
