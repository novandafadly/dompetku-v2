// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  isPrototype: vi.fn(),
  ruangContext: vi.fn(),
  addEntryAttachment: vi.fn(),
  getDecryptedAttachment: vi.fn(),
  deleteEntryAttachment: vi.fn(),
  allowUpload: vi.fn(),
}));

class NotFoundError extends Error {
  constructor() {
    super('NEXT_NOT_FOUND');
  }
}

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  unstable_rethrow: (e: unknown) => {
    if (e instanceof NotFoundError) throw e;
  },
}));
vi.mock('@/server/env', () => ({ isPrototype: m.isPrototype }));
vi.mock('../../../_real/context', () => ({ ruangContext: m.ruangContext }));
vi.mock('@/server/ledger/struk', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/struk')>()),
  addEntryAttachment: m.addEntryAttachment,
  getDecryptedAttachment: m.getDecryptedAttachment,
  deleteEntryAttachment: m.deleteEntryAttachment,
  receiptUploadLimiter: { allow: m.allowUpload },
}));

import { ReceiptValidationError } from '@/server/ledger/struk';
import { POST } from './route';
import { DELETE, GET } from './[attachmentId]/route';

const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
const ATT_ID = '22222222-2222-4222-8222-222222222222';
const CTX = {
  pools: {},
  userId: '33333333-3333-4333-8333-333333333333',
  spaceId: '44444444-4444-4444-8444-444444444444',
  ruang: 'pribadi' as const,
  kind: 'personal' as const,
};
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

beforeEach(() => {
  vi.clearAllMocks();
  m.isPrototype.mockReturnValue(false);
  m.ruangContext.mockResolvedValue(CTX);
  m.allowUpload.mockReturnValue(true);
});

describe('POST /[ruang]/transaksi/[id]/struk', () => {
  it('prototipe melempar notFound', async () => {
    m.isPrototype.mockReturnValue(true);
    const req = new Request(`https://app.test/pribadi/transaksi/${ENTRY_ID}/struk`, {
      method: 'POST',
    });
    await expect(
      POST(req, { params: Promise.resolve({ ruang: 'pribadi', id: ENTRY_ID }) }),
    ).rejects.toThrow(NotFoundError);
  });

  it('menolak mutasi cross-site dengan 403', async () => {
    const req = new Request(`https://app.test/pribadi/transaksi/${ENTRY_ID}/struk`, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    const res = await POST(req, { params: Promise.resolve({ ruang: 'pribadi', id: ENTRY_ID }) });
    expect(res.status).toBe(403);
    expect(m.ruangContext).not.toHaveBeenCalled();
  });

  it('menolak rate limit dengan 429 dan Retry-After', async () => {
    m.allowUpload.mockReturnValue(false);
    const req = new Request(`https://app.test/pribadi/transaksi/${ENTRY_ID}/struk`, {
      method: 'POST',
    });
    const res = await POST(req, { params: Promise.resolve({ ruang: 'pribadi', id: ENTRY_ID }) });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3600');
  });

  it('mengunggah PNG sah → 201 dengan Cache-Control no-store', async () => {
    const attachment = {
      id: ATT_ID,
      mimeType: 'image/png',
      byteSize: PNG_BYTES.length,
      uploadedBy: CTX.userId,
      createdAt: '2026-11-24T12:00:00+07:00',
    };
    m.addEntryAttachment.mockResolvedValueOnce(attachment);

    const form = new FormData();
    form.set('file', new File([PNG_BYTES], 'struk.png', { type: 'image/png' }));
    const req = new Request(`https://app.test/pribadi/transaksi/${ENTRY_ID}/struk`, {
      method: 'POST',
      body: form,
    });

    const res = await POST(req, { params: Promise.resolve({ ruang: 'pribadi', id: ENTRY_ID }) });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.json()).toEqual({ attachment });
  });

  it('memetakan berkas bukan gambar (SVG) ke 400 invalid_image', async () => {
    m.addEntryAttachment.mockRejectedValueOnce(new ReceiptValidationError('invalid_image'));
    const form = new FormData();
    form.set('file', new File(['<svg></svg>'], 'x.svg', { type: 'image/svg+xml' }));
    const req = new Request(`https://app.test/pribadi/transaksi/${ENTRY_ID}/struk`, {
      method: 'POST',
      body: form,
    });
    const res = await POST(req, { params: Promise.resolve({ ruang: 'pribadi', id: ENTRY_ID }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_image' });
  });
});

describe('GET & DELETE /[ruang]/transaksi/[id]/struk/[attachmentId]', () => {
  it('GET mengembalikan byte gambar dengan nosniff dan private, no-store', async () => {
    m.getDecryptedAttachment.mockResolvedValueOnce({
      mimeType: 'image/png',
      bytes: Buffer.from(PNG_BYTES),
      ext: 'png',
    });
    const req = new Request(`https://app.test/pribadi/transaksi/${ENTRY_ID}/struk/${ATT_ID}`);
    const res = await GET(req, {
      params: Promise.resolve({ ruang: 'pribadi', id: ENTRY_ID, attachmentId: ATT_ID }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-disposition')).toBe('inline; filename="struk.png"');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf).toEqual(PNG_BYTES);
  });

  it('GET mengembalikan 404 jika lampiran tidak ditemukan atau beda entri', async () => {
    m.getDecryptedAttachment.mockResolvedValueOnce(null);
    const req = new Request(`https://app.test/pribadi/transaksi/${ENTRY_ID}/struk/${ATT_ID}`);
    const res = await GET(req, {
      params: Promise.resolve({ ruang: 'pribadi', id: ENTRY_ID, attachmentId: ATT_ID }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE menolak cross-site 403 dan menghapus permanen → 200', async () => {
    const badReq = new Request(`https://app.test/pribadi/transaksi/${ENTRY_ID}/struk/${ATT_ID}`, {
      method: 'DELETE',
      headers: { origin: 'https://evil.example' },
    });
    const badRes = await DELETE(badReq, {
      params: Promise.resolve({ ruang: 'pribadi', id: ENTRY_ID, attachmentId: ATT_ID }),
    });
    expect(badRes.status).toBe(403);

    m.deleteEntryAttachment.mockResolvedValueOnce(true);
    const okReq = new Request(`https://app.test/pribadi/transaksi/${ENTRY_ID}/struk/${ATT_ID}`, {
      method: 'DELETE',
      headers: { origin: 'https://app.test' },
    });
    const okRes = await DELETE(okReq, {
      params: Promise.resolve({ ruang: 'pribadi', id: ENTRY_ID, attachmentId: ATT_ID }),
    });
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ deleted: true });
  });

  it('GET memetakan decrypt_failed ke 500 dan invalid_key ke 503 not_configured', async () => {
    const { ReceiptCryptoError } = await import('@/server/ledger/struk-crypto');
    m.getDecryptedAttachment.mockRejectedValueOnce(new ReceiptValidationError('decrypt_failed'));
    const r1 = await GET(
      new Request(`https://app.test/pribadi/transaksi/${ENTRY_ID}/struk/${ATT_ID}`),
      {
        params: Promise.resolve({ ruang: 'pribadi', id: ENTRY_ID, attachmentId: ATT_ID }),
      },
    );
    expect(r1.status).toBe(500);
    expect(await r1.json()).toEqual({ error: 'decrypt_failed' });

    m.getDecryptedAttachment.mockRejectedValueOnce(new ReceiptCryptoError('invalid_key'));
    const r2 = await GET(
      new Request(`https://app.test/pribadi/transaksi/${ENTRY_ID}/struk/${ATT_ID}`),
      {
        params: Promise.resolve({ ruang: 'pribadi', id: ENTRY_ID, attachmentId: ATT_ID }),
      },
    );
    expect(r2.status).toBe(503);
    expect(await r2.json()).toEqual({ error: 'not_configured' });
  });
});
