/**
 * Aturan sesi (BSD §5, TRD §3.4, AFD §0): faktor kuat wajib = passkey ATAU kata sandi + TOTP.
 * Modul murni (tanpa DB) agar keputusan akses diuji unit.
 */

export const AMR_VALUES = ['passkey', 'password+totp', 'password', 'recovery'] as const;
export type Amr = (typeof AMR_VALUES)[number];

export const STRONG_AMR: readonly Amr[] = ['passkey', 'password+totp'];

/** Sesi berumur lebih dari ini ditolak walau masih aktif (absolut, keputusan pemilik #4). */
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
/** Idle: Better Auth `session.expiresIn`, diperpanjang tiap `updateAge` saat dipakai. */
export const SESSION_IDLE_S = 7 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_S = 24 * 60 * 60;
/** Step-up: tambah faktor (passkey) hanya dengan sesi semuda ini (TRD §3.4: ≤ 10 menit). */
export const FRESH_AGE_S = 10 * 60;

/**
 * Jalur Better Auth yang membuat sesi → nilai `amr`. Jalur lain (daftar, masuk kata sandi tanpa
 * TOTP) = `password`, yaitu keadaan enrolling. Sesi kode pemulihan ditandai di config.ts.
 */
const AMR_BY_PATH: Record<string, Amr> = {
  '/passkey/verify-authentication': 'passkey',
  '/two-factor/verify-totp': 'password+totp',
};

export function amrForPath(path: string | undefined): Amr {
  return (path === undefined ? undefined : AMR_BY_PATH[path]) ?? 'password';
}

export function isAmr(value: unknown): value is Amr {
  return typeof value === 'string' && (AMR_VALUES as readonly string[]).includes(value);
}

export interface SessionFacts {
  amr: unknown;
  createdAt: Date;
  now: Date;
  /** User sudah punya passkey atau TOTP terverifikasi. */
  hasStrongFactor: boolean;
  /** Baris app.profiles ada (akun pertama dibuat atau undangan diterima). */
  provisioned: boolean;
}

export type Access =
  | { kind: 'full' }
  /** Hanya /amankan (daftar faktor, kode pemulihan, selesaikan). */
  | { kind: 'securing' }
  | { kind: 'denied'; reason: 'expired' | 'no_amr' | 'needs_strong_factor' };

export function sessionAccess(f: SessionFacts): Access {
  if (f.now.getTime() - f.createdAt.getTime() > SESSION_ABSOLUTE_MS)
    return { kind: 'denied', reason: 'expired' };
  if (!isAmr(f.amr)) return { kind: 'denied', reason: 'no_amr' };
  if (STRONG_AMR.includes(f.amr)) return f.provisioned ? { kind: 'full' } : { kind: 'securing' };
  if (f.amr === 'recovery') return { kind: 'securing' };
  // Kata sandi saja: hanya untuk akun yang belum punya faktor kuat (lanjutkan mengamankan).
  // Akun yang sudah punya passkey/TOTP wajib memakainya; kalau tidak, kata sandi bocor cukup
  // untuk mendaftarkan faktor baru.
  return f.hasStrongFactor
    ? { kind: 'denied', reason: 'needs_strong_factor' }
    : { kind: 'securing' };
}
