import { z } from 'zod';

/**
 * Sumber harga penutupan saham IDX (S14, K1). Jalur utama tetap input manual di web; sumber ini
 * hanya dipakai job price_refresh bila PRICE_PROVIDER diisi. Kode = 4 huruf kapital BEI
 * (pemetaan ke simbol penyedia urusan adapter), `on` = tanggal WIB `YYYY-MM-DD`.
 */
export interface PriceQuote {
  ticker: string;
  close: number;
}

export interface PriceSource {
  /** Paling banyak MAX_TICKERS kode per panggilan; kode tanpa harga cukup tidak dikembalikan. */
  fetchClose(tickers: readonly string[], on: string): Promise<PriceQuote[]>;
}

export const MAX_TICKERS = 100;

/**
 * Galat penyedia untuk job_runs, log, dan alert: hanya kode singkat, tanpa URL, kunci, atau isi
 * respons (pesan galat fetch bisa memuat URL lengkap).
 */
export type ProviderCode =
  | 'provider_timeout'
  | 'provider_network'
  | 'provider_http_4xx'
  | 'provider_http_5xx'
  | 'provider_too_large'
  | 'provider_shape';

export class ProviderError extends Error {
  constructor(readonly code: ProviderCode) {
    super(code);
    this.name = 'ProviderError';
  }
}

/**
 * Adapter terdaftar menurut nilai PRICE_PROVIDER. Kosong sampai Task 8 (K1: Yahoo best-effort);
 * nilai lain ditolak checkConfig.
 */
export const PROVIDERS: ReadonlyMap<string, () => PriceSource> = new Map();

export interface HttpOptions {
  /** Origin tetap penyedia (https:). Path relatif tidak bisa keluar dari origin ini. */
  base: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

const MAX_BYTES = 256 * 1024;

/**
 * Pembungkus fetch untuk adapter: GET JSON ke origin tetap, `redirect: 'error'`, timeout 10 s,
 * badan maks 256 KiB (dibaca bertahap, dihentikan begitu lewat), bentuk divalidasi Zod. Semua
 * kegagalan menjadi ProviderError tanpa pesan asli.
 */
export function httpJson(opts: HttpOptions) {
  const base = new URL(opts.base);
  if (base.protocol !== 'https:') throw new Error('provider_base_not_https');
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;

  return async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const url = new URL(path, base);
    // `//host/…` atau URL absolut di path akan berpindah origin.
    if (url.origin !== base.origin) throw new Error('provider_path_invalid');

    let res: Response;
    try {
      res = await doFetch(url, {
        method: 'GET',
        headers: { accept: 'application/json', ...opts.headers },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ProviderError(isTimeout(err) ? 'provider_timeout' : 'provider_network');
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new ProviderError(res.status < 500 ? 'provider_http_4xx' : 'provider_http_5xx');
    }

    let text: string;
    try {
      text = await readLimited(res, maxBytes);
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(isTimeout(err) ? 'provider_timeout' : 'provider_network');
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderError('provider_shape');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ProviderError('provider_shape');
    return parsed.data;
  };
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new ProviderError('provider_too_large');
  }
  if (!res.body) return '';
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ProviderError('provider_too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Sumber palsu untuk tes (tanpa jaringan): jawaban dari fungsi, setiap panggilan dicatat. */
export class StubPriceSource implements PriceSource {
  readonly calls: { tickers: string[]; on: string }[] = [];
  constructor(
    private readonly answer: (
      tickers: readonly string[],
      on: string,
    ) => PriceQuote[] | Promise<PriceQuote[]>,
  ) {}
  async fetchClose(tickers: readonly string[], on: string): Promise<PriceQuote[]> {
    this.calls.push({ tickers: [...tickers], on });
    return this.answer(tickers, on);
  }
}
