import { describe, expect, it } from 'vitest';
import { sectionFromPathname, tabFromPathname } from './hrefs';

describe('layar di luar tab (Sampah, Kategori)', () => {
  it('sectionFromPathname mengenali /{ruang}/sampah dan /kategori', () => {
    expect(sectionFromPathname('/pribadi/sampah')).toBe('sampah');
    expect(sectionFromPathname('/bersama/kategori')).toBe('kategori');
    expect(sectionFromPathname('/pribadi/transaksi')).toBeNull();
    expect(sectionFromPathname('/masuk')).toBeNull();
  });

  it('Sampah bukan tab: induknya Transaksi yang tampak aktif, bukan Beranda', () => {
    expect(tabFromPathname('/pribadi/sampah')).toBe('transaksi');
    expect(tabFromPathname('/pribadi/dompet')).toBe('dompet');
    expect(tabFromPathname('/masuk')).toBe('beranda');
  });
});
