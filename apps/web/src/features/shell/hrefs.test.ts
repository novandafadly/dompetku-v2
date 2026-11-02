import { describe, expect, it } from 'vitest';
import { buildAddWalletHref, sectionFromPathname, tabFromPathname } from './hrefs';

describe('layar di luar tab (Sampah, Kategori)', () => {
  it('sectionFromPathname mengenali /{ruang}/sampah dan /kategori', () => {
    expect(sectionFromPathname('/pribadi/sampah')).toBe('sampah');
    expect(sectionFromPathname('/bersama/kategori')).toBe('kategori');
    expect(sectionFromPathname('/pribadi/transaksi')).toBeNull();
    expect(sectionFromPathname('/masuk')).toBeNull();
  });

  it('Sampah bukan tab: induknya Transaksi yang tampak aktif, bukan Beranda', () => {
    expect(tabFromPathname('/pribadi/sampah')).toBe('transaksi');
    // Kategori (Menu → Kategori) juga bukan tab: Transaksi yang tampak aktif, sama dengan Sampah.
    expect(tabFromPathname('/pribadi/kategori')).toBe('transaksi');
    expect(tabFromPathname('/bersama/kategori')).toBe('transaksi');
    expect(tabFromPathname('/pribadi/dompet')).toBe('dompet');
    expect(tabFromPathname('/masuk')).toBe('beranda');
  });
});

describe('buildAddWalletHref (S6-C6: Tambah dompet dari Catat dan Beranda)', () => {
  it('Dompet ruang itu dengan ?tambah=1, query yang dibawa tetap ada', () => {
    expect(buildAddWalletHref('pribadi', '')).toBe('/pribadi/dompet?tambah=1');
    expect(buildAddWalletHref('bersama', '?theme=light')).toBe(
      '/bersama/dompet?theme=light&tambah=1',
    );
  });
});
