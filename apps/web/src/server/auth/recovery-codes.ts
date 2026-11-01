import { randomBytes, timingSafeEqual } from 'node:crypto';
import { argon2idAsync } from '@noble/hashes/argon2.js';

/**
 * Kode pemulihan sendiri (BSD §5, keputusan pemilik #1): 10 kode per user, sekali pakai, hash
 * argon2id (PHC string) di auth.recovery_codes. Kode = 10 simbol base32 Crockford (50 bit),
 * ditampilkan `XXXXX-XXXXX`. Entropi tinggi + jeda gagal, jadi parameter argon2 ringan
 * (4 MiB, t=3) cukup dan tetap cepat di JS murni (image tanpa biner native).
 */

export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PARAMS = { m: 4096, t: 3, p: 1 } as const;
const HASH_LEN = 32;

export function generateRecoveryCode(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (const b of bytes) out += ALPHABET.charAt(b & 31);
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export function generateRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < n) codes.add(generateRecoveryCode());
  return [...codes];
}

/** Huruf besar, tanpa spasi/strip, O→0 dan I/L→1 (Crockford). Null bila bukan bentuk kode. */
export function normalizeRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 10) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64').replace(/=+$/, '');

export async function hashRecoveryCode(code: string): Promise<string> {
  const normalized = normalizeRecoveryCode(code);
  if (normalized === null) throw new Error('kode pemulihan tidak valid');
  const salt = randomBytes(16);
  const hash = await argon2idAsync(normalized, salt, { ...PARAMS, dkLen: HASH_LEN });
  return `$argon2id$v=19$m=${String(PARAMS.m)},t=${String(PARAMS.t)},p=${String(PARAMS.p)}$${b64(salt)}$${b64(hash)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export async function verifyRecoveryCode(code: string, phc: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(code);
  const m = PHC.exec(phc);
  if (normalized === null || m === null) return false;
  const [, mem, t, p, salt, hash] = m as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const expected = Buffer.from(hash, 'base64');
  const actual = await argon2idAsync(normalized, Buffer.from(salt, 'base64'), {
    m: Number(mem),
    t: Number(t),
    p: Number(p),
    dkLen: expected.length,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Hash pengganti untuk user yang tidak ada, agar waktu respons setara (respons seragam). */
export const DUMMY_RECOVERY_HASH =
  '$argon2id$v=19$m=4096,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/**
 * Tepat RECOVERY_CODE_COUNT hash untuk diverifikasi: sisa diisi hash pengganti, kelebihan
 * dipotong. Jumlah verifikasi argon2 sama untuk email terdaftar, tak terdaftar, atau sisa kode.
 */
export function padRecoveryHashes(hashes: readonly string[]): string[] {
  const out = hashes.slice(0, RECOVERY_CODE_COUNT);
  while (out.length < RECOVERY_CODE_COUNT) out.push(DUMMY_RECOVERY_HASH);
  return out;
}
