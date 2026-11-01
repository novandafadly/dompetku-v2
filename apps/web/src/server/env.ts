/**
 * Konfigurasi runtime server (TRD §3.4 "Secrets"). Dibaca sekali saat modul auth pertama kali
 * dipakai; nilai yang hilang menggagalkan request pertama dengan pesan yang menyebut nama variabel,
 * bukan nilainya. Nama variabel juga ada di .env.example dan infra/db-vm/env/web.env.example.
 */
export interface ServerEnv {
  /** Koneksi Postgres sebagai dompetku_web (BSD §3). */
  databaseUrl: string;
  /** Kunci tanda tangan cookie dan enkripsi rahasia TOTP (minimal 32 karakter). */
  authSecret: string;
  /** Origin publik, mis. https://dompet.novandafadly.com. */
  baseURL: string;
  /** Relying party passkey; bawaan = hostname baseURL. */
  rpID: string;
  /** Cookie `__Host-` + Secure. Mati hanya bila baseURL http dan bukan localhost. */
  secureCookies: boolean;
  /** Kunci API Resend; null = email ditulis ke log (hanya di luar produksi). */
  resendApiKey: string | null;
  /** Pengirim email, mis. "DompetKu <dompet@novandafadly.com>". */
  emailFrom: string;
  /** Tolak kata sandi yang pernah bocor (Have I Been Pwned, k-anonymity). */
  checkPwnedPasswords: boolean;
  /** Hanya tes e2e auth: email ditulis sebagai JSON per baris ke berkas ini, bukan dikirim. */
  emailFile: string | null;
}

export class EnvError extends Error {
  override name = 'EnvError';
}

type Source = Record<string, string | undefined>;

function optional(env: Source, name: string): string | undefined {
  const v = env[name]?.trim();
  return v === '' ? undefined : v;
}

function required(env: Source, name: string): string {
  const v = env[name]?.trim();
  if (!v) throw new EnvError(`Variabel lingkungan ${name} wajib diisi`);
  return v;
}

export function readServerEnv(env: Source = process.env): ServerEnv {
  const production = env.NODE_ENV === 'production';
  const databaseUrl = required(env, 'DATABASE_URL');
  const authSecret = required(env, 'BETTER_AUTH_SECRET');
  if (authSecret.length < 32) throw new EnvError('BETTER_AUTH_SECRET minimal 32 karakter');
  const baseURL = required(env, 'BETTER_AUTH_URL').replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    throw new EnvError('BETTER_AUTH_URL bukan URL');
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '')
    throw new EnvError('BETTER_AUTH_URL hanya origin, tanpa path');
  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (production && url.protocol !== 'https:' && !localhost)
    throw new EnvError('BETTER_AUTH_URL wajib https di produksi');
  const resendApiKey = env.RESEND_API_KEY?.trim() ?? '';
  if (
    production &&
    resendApiKey === '' &&
    env.AUTH_EMAIL_LOG !== '1' &&
    optional(env, 'AUTH_EMAIL_FILE') === undefined
  )
    throw new EnvError('Variabel lingkungan RESEND_API_KEY wajib diisi');
  return {
    databaseUrl,
    authSecret,
    baseURL: url.origin,
    rpID: optional(env, 'AUTH_RP_ID') ?? url.hostname,
    secureCookies: url.protocol === 'https:' || localhost,
    resendApiKey: resendApiKey === '' ? null : resendApiKey,
    emailFrom: optional(env, 'AUTH_EMAIL_FROM') ?? 'DompetKu <dompet@novandafadly.com>',
    checkPwnedPasswords: env.AUTH_CHECK_PWNED !== '0',
    // Diabaikan bila Resend aktif: email sungguhan tidak pernah dialihkan ke berkas.
    emailFile: resendApiKey === '' ? (optional(env, 'AUTH_EMAIL_FILE') ?? null) : null,
  };
}

/**
 * Mode prototipe (data demo, auth tiruan). Dibaca saat runtime dengan kunci dinamis agar Next
 * tidak menanamkan nilai saat build: satu build standalone dipakai e2e prototipe (=1) dan
 * produksi (kosong).
 */
export function isPrototype(env: Source = process.env): boolean {
  const key = 'NEXT_PUBLIC_PROTOTYPE';
  return env[key] === '1';
}
