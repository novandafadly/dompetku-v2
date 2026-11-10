import { describe, expect, it } from 'vitest';
import { uuidV5 } from './uuid';

const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const URL_NS = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

describe('uuidV5', () => {
  // RFC 9562 (pengganti RFC 4122) Lampiran A.4, dan vektor uuid5 Python standar.
  it.each([
    [DNS, 'www.example.com', '2ed6657d-e927-568b-95e1-2665a8aea6a2'],
    [DNS, 'python.org', '886313e1-3b8a-5372-9b90-0c9aee199e5d'],
    [URL_NS, 'http://python.org/', '4c565f0d-3f5a-5890-b41b-20cf47701c5e'],
  ])('vektor tetap %s / %s', (ns, name, want) => {
    expect(uuidV5(ns, name)).toBe(want);
  });

  it('deterministik, beda nama = beda uuid, versi 5 varian RFC', () => {
    const a = uuidV5(DNS, 'pesan-1');
    expect(uuidV5(DNS, 'pesan-1')).toBe(a);
    expect(uuidV5(DNS, 'pesan-2')).not.toBe(a);
    expect(uuidV5(URL_NS, 'pesan-1')).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('namespace huruf besar sama dengan huruf kecil; nama UTF-8', () => {
    expect(uuidV5(DNS.toUpperCase(), 'www.example.com')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
    expect(uuidV5(DNS, 'kopi ☕')).toBe(uuidV5(DNS, 'kopi ☕'));
  });

  it('namespace bukan uuid = galat', () => {
    expect(() => uuidV5('bukan-uuid', 'x')).toThrow(TypeError);
    expect(() => uuidV5('6ba7b8109dad11d180b400c04fd430c8', 'x')).toThrow(TypeError);
  });
});
