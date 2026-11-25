import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Enkripsi & validasi biner foto struk (S18, K1/K4):
 * - AES-256-GCM dengan IV acak 12 byte per lampiran, tag autentikasi 16 byte, dan AAD yang
 *   mengikat ciphertext ke `(spaceId, entryId, attachmentId)` agar baris tidak dapat dipindahkan
 *   antar ruang atau antar transaksi.
 * - Validasi magic-byte ketat: hanya JPEG, PNG, dan WebP; SVG/HTML/PDF/teks ditolak keras.
 * - Kunci dibaca dari `RECEIPT_ENCRYPTION_KEY` (64 huruf hex atau 32-byte base64/base64url).
 *   Tidak pernah melog kunci maupun isi biner foto.
 */

export const MAX_RECEIPT_BYTES = 2 * 1024 * 1024; // 2 MiB (selaras check DB 0151_foto_struk.sql)
export const MAX_RECEIPTS_PER_ENTRY = 3;
export const RECEIPT_KEY_VERSION = 1;

export type ReceiptMime = 'image/jpeg' | 'image/png' | 'image/webp';

export const RECEIPT_EXT: Record<ReceiptMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface ReceiptAadParts {
  spaceId: string;
  entryId: string;
  attachmentId: string;
}

export interface EncryptedReceipt {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

export class ReceiptCryptoError extends Error {
  readonly code: 'invalid_key' | 'decrypt_failed' | 'invalid_payload';

  constructor(code: 'invalid_key' | 'decrypt_failed' | 'invalid_payload') {
    super(`receipt_${code}`);
    this.name = 'ReceiptCryptoError';
    this.code = code;
  }
}

const HEX_64_RE = /^[0-9a-fA-F]{64}$/;
const BASE64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

/**
 * Parse kunci 32-byte dari env (`RECEIPT_ENCRYPTION_KEY`).
 * - Kosong / tidak diset → `null` (fitur unggah nonaktif secara jujur).
 * - Diisi tapi rusak / bukan 32 byte → lempar `ReceiptCryptoError('invalid_key')` (fail-closed).
 */
export function parseReceiptEncryptionKey(raw: string | undefined): Buffer | null {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === '') return null;
  if (HEX_64_RE.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  if (BASE64_RE.test(trimmed)) {
    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(normalized, 'base64');
    if (decoded.length === 32) {
      return decoded;
    }
  }
  throw new ReceiptCryptoError('invalid_key');
}

export function getReceiptEncryptionKey(
  env: Record<string, string | undefined> = process.env,
): Buffer | null {
  return parseReceiptEncryptionKey(env.RECEIPT_ENCRYPTION_KEY);
}

/**
 * Deteksi MIME gambar murni dari magic bytes (mengabaikan ekstensi / header Content-Type klien).
 * Menolak SVG, HTML, PDF, GIF, atau berkas teks agar tidak pernah ada eksekusi skrip / XSS.
 */
export function detectImageMime(bytes: Uint8Array): ReceiptMime | null {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export function buildReceiptAad(parts: ReceiptAadParts): Buffer {
  return Buffer.from(
    `dompetku:receipt:v1:${parts.spaceId}:${parts.entryId}:${parts.attachmentId}`,
    'utf8',
  );
}

export function encryptReceipt(
  plaintext: Uint8Array,
  key: Buffer,
  aadParts: ReceiptAadParts,
): EncryptedReceipt {
  if (key.length !== 32) throw new ReceiptCryptoError('invalid_key');
  if (plaintext.length < 1 || plaintext.length > MAX_RECEIPT_BYTES) {
    throw new ReceiptCryptoError('invalid_payload');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(buildReceiptAad(aadParts));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext,
    iv,
    authTag,
    keyVersion: RECEIPT_KEY_VERSION,
  };
}

export function decryptReceipt(
  payload: { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array },
  key: Buffer,
  aadParts: ReceiptAadParts,
): Buffer {
  if (key.length !== 32) throw new ReceiptCryptoError('invalid_key');
  if (
    payload.iv.length !== 12 ||
    payload.authTag.length !== 16 ||
    payload.ciphertext.length < 1 ||
    payload.ciphertext.length > MAX_RECEIPT_BYTES
  ) {
    throw new ReceiptCryptoError('invalid_payload');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, payload.iv, { authTagLength: 16 });
    decipher.setAAD(buildReceiptAad(aadParts));
    decipher.setAuthTag(payload.authTag);
    return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
  } catch {
    throw new ReceiptCryptoError('decrypt_failed');
  }
}
