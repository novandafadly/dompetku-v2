import { describe, expect, it } from 'vitest';
import {
  buildAddWalletHref,
  buildDebtHref,
  buildDebtListHref,
  buildKontakHref,
  sectionFromPathname,
  tabFromPathname,
} from './hrefs';

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

  it('Laporan: bagian di luar tab, tanpa tab aktif (K8)', () => {
    expect(sectionFromPathname('/pribadi/laporan')).toBe('laporan');
    expect(tabFromPathname('/bersama/laporan')).toBeNull();
  });
});

describe('WhatsApp: bagian di luar tab', () => {
  it('dikenali sebagai section, tanpa tab aktif', () => {
    expect(sectionFromPathname('/pribadi/whatsapp')).toBe('whatsapp');
    expect(tabFromPathname('/bersama/whatsapp')).toBeNull();
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

describe('Utang dan Kontak (S11)', () => {
  it('alamat daftar, detail, dan Kontak; query yang dibawa tetap ada', () => {
    expect(buildDebtListHref('pribadi', '')).toBe('/pribadi/rencana?bagian=utang');
    expect(buildDebtListHref('pribadi', '?theme=light')).toBe(
      '/pribadi/rencana?theme=light&bagian=utang',
    );
    expect(buildDebtHref('pribadi', 'abc', '?theme=dark')).toBe(
      '/pribadi/rencana/utang/abc?theme=dark',
    );
    expect(buildKontakHref('pribadi', '')).toBe('/pribadi/kontak');
  });
  it('Kontak di luar tab: tanpa tab aktif; detail utang tetap tab Rencana', () => {
    expect(tabFromPathname('/pribadi/kontak')).toBeNull();
    expect(tabFromPathname('/pribadi/rencana/utang/abc')).toBe('rencana');
  });
});
