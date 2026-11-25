import { notFound, unstable_rethrow } from 'next/navigation';
import { isPrototype } from '@/server/env';
import { isSpaceNotFoundError } from '@/server/ledger/errors';
import {
  deleteEntryAttachment,
  getDecryptedAttachment,
  isCrossSiteMutation,
  ReceiptValidationError,
} from '@/server/ledger/struk';
import { ReceiptCryptoError } from '@/server/ledger/struk-crypto';
import { errorTag } from '@/server/ledger/transaksi';
import { ruangContext } from '../../../../_real/context';

/**
 * Unduh (dekripsi di server) dan hapus permanen foto struk (S18):
 * `GET|DELETE /[ruang]/transaksi/[id]/struk/[attachmentId]`.
 *
 * Keamanan:
 * - Prototipe 404; mode nyata wajib `ruangContext` (sesi penuh + anggota ruang).
 * - `GET` mengembalikan byte gambar asli dengan `Content-Type` hasil deteksi server,
 *   `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, dan
 *   `Content-Disposition: inline; filename="struk.<ext>"`. Tidak pernah di-cache SW/browser.
 * - `DELETE` memeriksa same-origin lalu menghapus permanen baris + ciphertext.
 */
export const dynamic = 'force-dynamic';

const json = (body: Record<string, unknown>, status: number) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ruang: string; id: string; attachmentId: string }> },
): Promise<Response> {
  if (isPrototype()) notFound();
  const resolved = await params;
  const ctx = await ruangContext(Promise.resolve({ ruang: resolved.ruang }));

  try {
    const found = await getDecryptedAttachment(ctx, {
      entryId: resolved.id,
      attachmentId: resolved.attachmentId,
    });
    if (found === null) return json({ error: 'not_found' }, 404);
    return new Response(new Uint8Array(found.bytes), {
      status: 200,
      headers: {
        'Content-Type': found.mimeType,
        'Content-Disposition': `inline; filename="struk.${found.ext}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    unstable_rethrow(e);
    if (isSpaceNotFoundError(e)) notFound();
    if (e instanceof ReceiptValidationError) {
      if (e.code === 'not_configured') return json({ error: 'not_configured' }, 503);
      if (e.code === 'decrypt_failed') {
        console.error('[struk] gagal dekripsi', e.code);
        return json({ error: 'decrypt_failed' }, 500);
      }
    }
    if (e instanceof ReceiptCryptoError) {
      console.error('[struk] gagal kunci/dekripsi', e.code);
      return e.code === 'invalid_key'
        ? json({ error: 'not_configured' }, 503)
        : json({ error: 'decrypt_failed' }, 500);
    }
    console.error('[struk] gagal unduh', errorTag(e));
    return json({ error: 'error' }, 500);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ ruang: string; id: string; attachmentId: string }> },
): Promise<Response> {
  if (isPrototype()) notFound();
  if (isCrossSiteMutation(req)) {
    return json({ error: 'forbidden' }, 403);
  }
  const resolved = await params;
  const ctx = await ruangContext(Promise.resolve({ ruang: resolved.ruang }));

  try {
    const deleted = await deleteEntryAttachment(ctx, {
      entryId: resolved.id,
      attachmentId: resolved.attachmentId,
    });
    if (!deleted) return json({ error: 'not_found' }, 404);
    return json({ deleted: true }, 200);
  } catch (e) {
    unstable_rethrow(e);
    if (isSpaceNotFoundError(e)) notFound();
    console.error('[struk] gagal hapus', errorTag(e));
    return json({ error: 'error' }, 500);
  }
}
