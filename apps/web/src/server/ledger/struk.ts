import 'server-only';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import type { AttachmentVM, ReceiptMime } from '@/features/transaksi/struk-types';
import { createRateLimiter } from '@/server/wa/ratelimit';
import { withLedger } from './retry';
import {
  decryptReceipt,
  detectImageMime,
  encryptReceipt,
  getReceiptEncryptionKey,
  MAX_RECEIPT_BYTES,
  RECEIPT_EXT,
  ReceiptCryptoError,
} from './struk-crypto';
import type { LedgerCtx } from './write';

/**
 * Layanan server lampiran foto struk terenkripsi (S18, `0151_foto_struk.sql`):
 * - Setiap foto divalidasi magic bytes (JPEG/PNG/WebP) dan ukuran (<= 2 MiB) lalu dienkripsi
 *   AES-256-GCM dengan AAD `(spaceId, entryId, attachmentId)` sebelum disimpan di `app.entry_attachments`.
 * - Setiap baca/tulis memakai `withLedger` (RLS ENABLE + FORCE + `assert_member`).
 * - Tidak pernah melog kunci, ciphertext, atau isi berkas.
 */

export const RECEIPT_UPLOAD_PER_USER_PER_HOUR = 20;
export const receiptUploadLimiter = createRateLimiter(RECEIPT_UPLOAD_PER_USER_PER_HOUR, 3_600_000);

export type ReceiptValidationCode =
  'invalid_id' | 'not_configured' | 'file_too_large' | 'invalid_image' | 'decrypt_failed';

export class ReceiptValidationError extends Error {
  readonly code: ReceiptValidationCode;

  constructor(code: ReceiptValidationCode) {
    super(`receipt_${code}`);
    this.name = 'ReceiptValidationError';
    this.code = code;
  }
}

const uuidSchema = z.uuid();
const mimeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);

const wib = (col: string) =>
  `to_char(${col} at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI:SS"+07:00"')`;

export function isReceiptUploadEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  try {
    return getReceiptEncryptionKey(env) !== null;
  } catch {
    return false;
  }
}

/**
 * Pertahanan berlapis CSRF untuk mutasi Route Handler (`POST`/`DELETE`):
 * tolak bila `Sec-Fetch-Site: cross-site` atau header `Origin` tidak cocok dengan host request.
 */
export function isCrossSiteMutation(req: Request): boolean {
  const fetchSite = req.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (fetchSite === 'cross-site') return true;
  const origin = req.headers.get('origin')?.trim();
  if (origin === undefined || origin === '') return false;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const fwdHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase();
    const headerHost = req.headers.get('host')?.trim().toLowerCase();
    const expectedHost =
      fwdHost !== undefined && fwdHost !== ''
        ? fwdHost
        : headerHost !== undefined && headerHost !== ''
          ? headerHost
          : new URL(req.url).host.toLowerCase();
    return originHost !== expectedHost;
  } catch {
    return true;
  }
}

function resolveKey(override?: Buffer): Buffer {
  if (override !== undefined) {
    if (override.length !== 32) throw new ReceiptCryptoError('invalid_key');
    return override;
  }
  const key = getReceiptEncryptionKey();
  if (key === null) throw new ReceiptValidationError('not_configured');
  return key;
}

/** Daftar metadata lampiran untuk satu entri ruang ini (tanpa byte ciphertext). */
export async function listEntryAttachmentsTx(
  c: pg.PoolClient,
  ctx: LedgerCtx,
  entryId: string,
): Promise<AttachmentVM[]> {
  if (!uuidSchema.safeParse(entryId).success) return [];
  const { rows } = await c.query<{
    id: string;
    mime_type: string;
    byte_size: number;
    uploaded_by: string;
    created_at: string;
  }>(
    `select a.id, a.mime_type, a.byte_size, a.uploaded_by, ${wib('a.created_at')} as created_at
       from api.list_entry_attachments(p_space_id => $1, p_entry_id => $2) a`,
    [ctx.spaceId, entryId],
  );
  return rows.map((r) => ({
    id: r.id,
    mimeType: mimeSchema.parse(r.mime_type),
    byteSize: r.byte_size,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
  }));
}

export async function addEntryAttachment(
  ctx: LedgerCtx,
  input: { entryId: string; bytes: Uint8Array },
  opts?: { key?: Buffer },
): Promise<AttachmentVM> {
  if (!uuidSchema.safeParse(input.entryId).success) {
    throw new ReceiptValidationError('invalid_id');
  }
  if (input.bytes.length < 1 || input.bytes.length > MAX_RECEIPT_BYTES) {
    throw new ReceiptValidationError('file_too_large');
  }
  const mimeType = detectImageMime(input.bytes);
  if (mimeType === null) {
    throw new ReceiptValidationError('invalid_image');
  }
  const key = resolveKey(opts?.key);
  const attachmentId = randomUUID();
  const encrypted = encryptReceipt(input.bytes, key, {
    spaceId: ctx.spaceId,
    entryId: input.entryId,
    attachmentId,
  });

  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<{ created_at: string }>(
      `select ${wib("(res ->> 'created_at')::timestamptz")} as created_at
         from (
           select api.add_entry_attachment(
             p_space_id => $1,
             p_entry_id => $2,
             p_attachment_id => $3,
             p_mime_type => $4,
             p_byte_size => $5,
             p_ciphertext => $6,
             p_iv => $7,
             p_auth_tag => $8,
             p_key_version => $9
           ) as res
         ) t`,
      [
        ctx.spaceId,
        input.entryId,
        attachmentId,
        mimeType,
        input.bytes.length,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        encrypted.keyVersion,
      ],
    );
    const createdAt = rows[0]?.created_at ?? '';
    return {
      id: attachmentId,
      mimeType,
      byteSize: input.bytes.length,
      uploadedBy: ctx.userId,
      createdAt,
    };
  });
}

export async function getDecryptedAttachment(
  ctx: LedgerCtx,
  input: { entryId: string; attachmentId: string },
  opts?: { key?: Buffer },
): Promise<{ mimeType: ReceiptMime; bytes: Buffer; ext: string } | null> {
  if (
    !uuidSchema.safeParse(input.entryId).success ||
    !uuidSchema.safeParse(input.attachmentId).success
  ) {
    return null;
  }
  const key = resolveKey(opts?.key);
  const row = await withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<{
      id: string;
      entry_id: string;
      mime_type: string;
      byte_size: number;
      ciphertext: Buffer;
      iv: Buffer;
      auth_tag: Buffer;
      key_version: number;
    }>(
      `select id, entry_id, mime_type, byte_size, ciphertext, iv, auth_tag, key_version
         from api.get_entry_attachment(p_space_id => $1, p_attachment_id => $2)`,
      [ctx.spaceId, input.attachmentId],
    );
    return rows[0] ?? null;
  });
  if (row?.entry_id !== input.entryId) return null;

  const mimeType = mimeSchema.parse(row.mime_type);
  try {
    const bytes = decryptReceipt(
      { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag },
      key,
      { spaceId: ctx.spaceId, entryId: row.entry_id, attachmentId: row.id },
    );
    return {
      mimeType,
      bytes,
      ext: RECEIPT_EXT[mimeType],
    };
  } catch (e) {
    if (e instanceof ReceiptCryptoError) {
      throw new ReceiptValidationError('decrypt_failed');
    }
    throw e;
  }
}

export async function deleteEntryAttachment(
  ctx: LedgerCtx,
  input: { entryId: string; attachmentId: string },
): Promise<boolean> {
  if (
    !uuidSchema.safeParse(input.entryId).success ||
    !uuidSchema.safeParse(input.attachmentId).success
  ) {
    return false;
  }
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    // Pastikan lampiran memang milik entri pada URL sebelum menghapus permanen.
    const { rows } = await c.query<{ entry_id: string }>(
      `select entry_id
         from api.get_entry_attachment(p_space_id => $1, p_attachment_id => $2)`,
      [ctx.spaceId, input.attachmentId],
    );
    const existing = rows[0];
    if (existing?.entry_id !== input.entryId) return false;
    await c.query(`select api.delete_entry_attachment(p_space_id => $1, p_attachment_id => $2)`, [
      ctx.spaceId,
      input.attachmentId,
    ]);
    return true;
  });
}
