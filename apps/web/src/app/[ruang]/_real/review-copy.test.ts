import { describe, expect, it } from 'vitest';
import { parseAdjust, REVIEW_COPY } from './review-copy';

describe('parseAdjust (−90..100, bilangan bulat)', () => {
  it.each([
    ['0', 0],
    ['25', 25],
    ['-90', -90],
    ['−10', -10], // tanda minus tipografis
    ['+5', 5],
    [' 100 ', 100],
  ])('%s = %s', (text, n) => {
    expect(parseAdjust(text)).toBe(n);
  });
  it.each(['', '-91', '101', '1.5', 'abc', '5%', '--5'])('%j = tidak sah', (text) => {
    expect(parseAdjust(text)).toBeNull();
  });
});

describe('REVIEW_COPY.copied', () => {
  it('menyebut bulan, ruang, yang dilewati, dan penyesuaian; tanpa nominal', () => {
    expect(REVIEW_COPY.copied(4, 'Desember 2026', 'pribadi', 2, -10)).toBe(
      '4 anggaran disalin ke Desember 2026 · Pribadi · 2 dilewati · disesuaikan −10%',
    );
    expect(REVIEW_COPY.copied(1, 'Desember 2026', 'bersama', 0, 0)).toBe(
      '1 anggaran disalin ke Desember 2026 · Bersama',
    );
  });
});
