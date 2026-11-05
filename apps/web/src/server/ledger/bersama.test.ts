import { describe, expect, it } from 'vitest';
import { encodeCursor, parseCursor, partnerOf, type Cursor } from './bersama';

/** Kursor `?sebelum=` halaman Aktivitas (R5): teks mikrodetik, galat = halaman pertama. */

const ENTRY = '0d6b9a52-7a51-4f43-9d0f-7b1f8b2c0a11';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

describe('encodeCursor/parseCursor', () => {
  it('pulang-pergi persis, ≤ 120 karakter', () => {
    const c: Cursor = { at: '2026-11-04T03:12:45.123456Z', entryId: ENTRY, version: 2_147_483_647 };
    const s = encodeCursor(c);
    expect(s.length).toBeLessThanOrEqual(120);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parseCursor(s)).toEqual(c);
  });

  it.each([
    ['tidak ada', undefined],
    ['kosong', ''],
    ['larik (query berulang)', [b64(`2026-11-04T03:12:45.123456Z|${ENTRY}|1`)]],
    ['bukan base64url', 'a+b/c='],
    ['terlalu panjang', 'A'.repeat(121)],
    ['bagian kurang', b64('2026-11-04T03:12:45.123456Z|' + ENTRY)],
    ['bagian lebih', b64(`2026-11-04T03:12:45.123456Z|${ENTRY}|1|x`)],
    ['milidetik (Date JS)', b64(`2026-11-04T03:12:45.123Z|${ENTRY}|1`)],
    ['tanpa zona Z', b64(`2026-11-04T03:12:45.123456|${ENTRY}|1`)],
    ['tanggal tidak ada', b64(`2026-02-30T03:12:45.123456Z|${ENTRY}|1`)],
    ['jam tidak ada', b64(`2026-11-04T24:00:00.000000Z|${ENTRY}|1`)],
    ['tahun terlalu kecil', b64(`0001-01-01T00:00:00.000000Z|${ENTRY}|1`)],
    ['bukan uuid', b64('2026-11-04T03:12:45.123456Z|bukan-uuid|1')],
    ['uuid huruf kapital', b64(`2026-11-04T03:12:45.123456Z|${ENTRY.toUpperCase()}|1`)],
    ['versi 0', b64(`2026-11-04T03:12:45.123456Z|${ENTRY}|0`)],
    ['versi nol di depan', b64(`2026-11-04T03:12:45.123456Z|${ENTRY}|01`)],
    ['versi di luar int4', b64(`2026-11-04T03:12:45.123456Z|${ENTRY}|2147483648`)],
    ['injeksi', b64(`2026-11-04T03:12:45.123456Z'; drop table x; --|${ENTRY}|1`)],
  ])('%s → null', (_, sp) => {
    expect(parseCursor(sp)).toBeNull();
  });

  it('bentuk base64 non-kanonik (bit sisa berbeda, byte sama) ditolak', () => {
    const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let checked = 0;
    for (const version of [1, 10, 100]) {
      const s = encodeCursor({ at: '2026-11-04T03:12:45.123456Z', entryId: ENTRY, version });
      if (s.length % 4 === 0) continue;
      const bytes = Buffer.from(s, 'base64url');
      for (const ch of ALPHA) {
        const alt = s.slice(0, -1) + ch;
        if (alt === s || !Buffer.from(alt, 'base64url').equals(bytes)) continue;
        expect(parseCursor(alt)).toBeNull();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('partnerOf', () => {
  const roster = [
    { id: 'n', name: 'Novanda', initial: 'N', role: 'owner' as const },
    { id: 'f', name: 'Farida', initial: 'F', role: 'member' as const },
  ];
  it('anggota lain menurut pembaca; solo = null', () => {
    expect(partnerOf(roster, 'n')).toEqual({ name: 'Farida', initial: 'F' });
    expect(partnerOf(roster, 'f')).toEqual({ name: 'Novanda', initial: 'N' });
    expect(partnerOf(roster.slice(0, 1), 'n')).toBeNull();
  });
});
