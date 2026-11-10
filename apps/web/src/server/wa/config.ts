import 'server-only';
import { EnvError } from '../env';

/** Konfigurasi Catat WhatsApp via OpenWA (spec 5.2). */
export interface WaEnv {
  /** Rahasia HMAC webhook (OpenWA mewajibkan minimal 16 karakter). */
  webhookSecret: string;
  /** Origin OpenWA; produksi http://openwa:2785 (network compose `wa`). */
  openwaUrl: string;
  apiKey: string;
  /** ID sesi OpenWA (UUID dari POST /api/sessions, bukan namanya). */
  session: string;
  maxAmount: number;
  ratePerMin: number;
  /** Nomor bot untuk ditampilkan di UI; tidak dipakai logika. */
  botNumber: string | null;
}

type Source = Record<string, string | undefined>;

/** Variabel yang menyalakan fitur. Batas (`WA_MAX_AMOUNT`, `WA_RATE_PER_MIN`) dan `WA_BOT_NUMBER`
 * saja tidak: `web.env.example` mengisi batas, dan fitur tetap mati sampai rahasia dan OpenWA
 * diisi. */
const REQUIRED = ['WA_WEBHOOK_SECRET', 'OPENWA_URL', 'OPENWA_API_KEY', 'OPENWA_SESSION'] as const;

function val(env: Source, name: string): string | undefined {
  const v = env[name]?.trim();
  return v === '' ? undefined : v;
}

function req(env: Source, name: string): string {
  const v = val(env, name);
  if (!v) throw new EnvError(`Variabel lingkungan ${name} wajib diisi`);
  return v;
}

function posInt(env: Source, name: string, fallback: number): number {
  const v = val(env, name);
  if (v === undefined) return fallback;
  if (!/^[0-9]+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) < 1)
    throw new EnvError(`${name} harus bilangan bulat positif`);
  return Number(v);
}

/** null = fitur mati (empat variabel wajib kosong). Sebagian terisi = EnvError. */
export function readWaEnv(env: Source = process.env): WaEnv | null {
  const configured = REQUIRED.some((n) => val(env, n) !== undefined);
  if (!configured) return null;
  const webhookSecret = req(env, 'WA_WEBHOOK_SECRET');
  if (webhookSecret.length < 16) throw new EnvError('WA_WEBHOOK_SECRET minimal 16 karakter');
  const rawUrl = req(env, 'OPENWA_URL').replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new EnvError('OPENWA_URL bukan URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new EnvError('OPENWA_URL harus http atau https');
  return {
    webhookSecret,
    openwaUrl: rawUrl,
    apiKey: req(env, 'OPENWA_API_KEY'),
    session: req(env, 'OPENWA_SESSION'),
    maxAmount: posInt(env, 'WA_MAX_AMOUNT', 100_000_000),
    ratePerMin: posInt(env, 'WA_RATE_PER_MIN', 30),
    botNumber: val(env, 'WA_BOT_NUMBER') ?? null,
  };
}
