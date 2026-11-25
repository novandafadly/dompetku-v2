import { notFound, unstable_rethrow } from 'next/navigation';
import { domainError } from '@/server/db';
import { isPrototype } from '@/server/env';
import { isSpaceNotFoundError } from '@/server/ledger/errors';
import {
  addEntryAttachment,
  isCrossSiteMutation,
  receiptUploadLimiter,
  ReceiptValidationError,
} from '@/server/ledger/struk';
import { MAX_RECEIPT_BYTES, ReceiptCryptoError } from '@/server/ledger/struk-crypto';
import { errorTag } from '@/server/ledger/transaksi';
import { ruangContext } from '../../../_real/context';

/**
 * Unggah foto struk terenkripsi AES-256-GCM (S18): `POST /[ruang]/transaksi/[id]/struk`.
 * Mode nyata saja (prototipe 404). Gerbang `ruangContext` (sesi penuh + anggota ruang),
 * cek same-origin, batas laju 20/jam/user, validasi ukuran (<= 2 MiB) & magic bytes (JPEG/PNG/WebP),
 * enkripsi AES-256-GCM + AAD, simpan atomik maks 3 per entri hidup. Selalu `no-store`.
 */
export const dynamic = 'force-dynamic';

const MAX_MULTIPART_BYTES = MAX_RECEIPT_BYTES + 65_536;

const json = (body: Record<string, unknown>, status: number, extra: Record<string, string> = {}) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ ruang: string; id: string }> },
): Promise<Response> {
  if (isPrototype()) notFound();
  if (isCrossSiteMutation(req)) {
    return json({ error: 'forbidden' }, 403);
  }
  const resolved = await params;
  const ctx = await ruangContext(Promise.resolve({ ruang: resolved.ruang }));

  if (!receiptUploadLimiter.allow(ctx.userId)) {
    return json({ error: 'rate_limited' }, 429, { 'Retry-After': '3600' });
  }

  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
    return json({ error: 'file_too_large' }, 413);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'invalid_form' }, 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return json({ error: 'missing_file' }, 400);
  }
  if (file.size < 1 || file.size > MAX_RECEIPT_BYTES) {
    return json({ error: 'file_too_large' }, 413);
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const attachment = await addEntryAttachment(ctx, { entryId: resolved.id, bytes });
    return json({ attachment }, 201);
  } catch (e) {
    unstable_rethrow(e);
    if (isSpaceNotFoundError(e)) notFound();
    if (e instanceof ReceiptValidationError) {
      switch (e.code) {
        case 'not_configured':
          return json({ error: 'not_configured' }, 503);
        case 'file_too_large':
          return json({ error: 'file_too_large' }, 413);
        case 'invalid_image':
          return json({ error: 'invalid_image' }, 400);
        case 'invalid_id':
          return json({ error: 'not_found' }, 404);
        default:
          return json({ error: 'error' }, 500);
      }
    }
    if (e instanceof ReceiptCryptoError) {
      console.error('[struk] konfigurasi kunci bermasalah', e.code);
      return json({ error: 'not_configured' }, 503);
    }
    const dbErr = domainError(e);
    if (dbErr?.code === 'DK404') return json({ error: 'not_found' }, 404);
    if (
      dbErr?.code === 'DK422' &&
      (dbErr.message === 'entry_voided' || dbErr.message === 'attachment_limit')
    ) {
      return json({ error: dbErr.message }, 422);
    }
    console.error('[struk] gagal unggah', errorTag(e));
    return json({ error: 'error' }, 500);
  }
}
