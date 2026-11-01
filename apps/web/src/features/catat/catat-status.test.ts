import { describe, expect, it } from 'vitest';
import { categoryArchivedText, galatText } from './catat-status';

describe('salinan galat Catat', () => {
  it('network = salinan S6-C2', () => {
    expect(galatText('network')).toBe(
      'Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan mencatat dua kali.',
    );
  });
  it('server (unknown/invalid/conflict)', () => {
    expect(galatText('server')).toBe(
      'Belum tersimpan. Ada kendala di server. Coba lagi tidak akan mencatat dua kali.',
    );
  });
  it('not_found', () => {
    expect(galatText('not_found')).toBe('Data ini sudah tidak ada. Tutup lalu buka Catat lagi.');
  });
  it('category_archived', () => {
    expect(categoryArchivedText('Makan')).toBe('Makan sudah diarsipkan. Pilih kategori lain.');
  });
});
