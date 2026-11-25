// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  decryptReceipt,
  detectImageMime,
  encryptReceipt,
  parseReceiptEncryptionKey,
  ReceiptCryptoError,
} from './struk-crypto';

const KEY_HEX = '11'.repeat(32);
const OTHER_KEY_HEX = '22'.repeat(32);
const AAD = {
  spaceId: '11111111-1111-4111-8111-111111111111',
  entryId: '22222222-2222-4222-8222-222222222222',
  attachmentId: '33333333-3333-4333-8333-333333333333',
};

describe('struk-crypto: kunci enkripsi', () => {
  it('menerima kunci 64-hex dan 32-byte base64, mengembalikan null bila kosong', () => {
    expect(parseReceiptEncryptionKey(undefined)).toBeNull();
    expect(parseReceiptEncryptionKey('   ')).toBeNull();

    const hexKey = parseReceiptEncryptionKey(KEY_HEX);
    expect(hexKey?.length).toBe(32);

    const b64 = hexKey?.toString('base64');
    const b64Key = parseReceiptEncryptionKey(b64);
    expect(b64Key?.equals(hexKey ?? Buffer.alloc(0))).toBe(true);
  });

  it('menolak kunci salah panjang secara fail-closed', () => {
    expect(() => parseReceiptEncryptionKey('abcd')).toThrow(ReceiptCryptoError);
    expect(() => parseReceiptEncryptionKey('not-a-valid-key!!!')).toThrow(ReceiptCryptoError);
  });
});

describe('struk-crypto: deteksi magic bytes', () => {
  it('menerima JPEG, PNG, dan WebP asli', () => {
    expect(detectImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image/jpeg');
    expect(
      detectImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])),
    ).toBe('image/png');
    expect(
      detectImageMime(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBe('image/webp');
  });

  it('menolak SVG, HTML, PDF, GIF, dan buffer kosong', () => {
    expect(
      detectImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).toBeNull();
    expect(detectImageMime(Buffer.from('<!doctype html><script>alert(1)</script>'))).toBeNull();
    expect(detectImageMime(Buffer.from('%PDF-1.7\n...'))).toBeNull();
    expect(detectImageMime(Buffer.from('GIF89a...'))).toBeNull();
    expect(detectImageMime(new Uint8Array([]))).toBeNull();
  });
});

describe('struk-crypto: AES-256-GCM + AAD', () => {
  it('round-trip enkripsi dan dekripsi dengan IV acak berbeda setiap panggilan', () => {
    const key = parseReceiptEncryptionKey(KEY_HEX);
    if (!key) throw new Error('key null');
    const plain = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

    const enc1 = encryptReceipt(plain, key, AAD);
    const enc2 = encryptReceipt(plain, key, AAD);
    expect(enc1.iv.length).toBe(12);
    expect(enc1.authTag.length).toBe(16);
    expect(enc1.iv.equals(enc2.iv)).toBe(false);
    expect(enc1.ciphertext.equals(plain)).toBe(false);

    const dec = decryptReceipt(enc1, key, AAD);
    expect(dec.equals(plain)).toBe(true);
  });

  it('menolak kunci salah, AAD ruang/entri/lampiran berbeda, dan ciphertext/tag yang diubah', () => {
    const key = parseReceiptEncryptionKey(KEY_HEX);
    const otherKey = parseReceiptEncryptionKey(OTHER_KEY_HEX);
    if (!key || !otherKey) throw new Error('key null');
    const plain = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x11, 0x22, 0x33]);
    const enc = encryptReceipt(plain, key, AAD);

    expect(() => decryptReceipt(enc, otherKey, AAD)).toThrow(ReceiptCryptoError);
    expect(() =>
      decryptReceipt(enc, key, { ...AAD, spaceId: '99999999-9999-4999-8999-999999999999' }),
    ).toThrow(ReceiptCryptoError);
    expect(() =>
      decryptReceipt(enc, key, { ...AAD, entryId: '99999999-9999-4999-8999-999999999999' }),
    ).toThrow(ReceiptCryptoError);
    expect(() =>
      decryptReceipt(enc, key, { ...AAD, attachmentId: '99999999-9999-4999-8999-999999999999' }),
    ).toThrow(ReceiptCryptoError);

    const tampered = Buffer.from(enc.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    expect(() => decryptReceipt({ ...enc, ciphertext: tampered }, key, AAD)).toThrow(
      ReceiptCryptoError,
    );
  });
});
