import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatRupiah, formatRupiahCompact, parseRupiah, spokenRupiah } from './money';

const NBSP = ' ';
const MINUS = '−';

describe('formatRupiah', () => {
  it.each([
    [1250000, {}, `Rp${NBSP}1.250.000`],
    [-35000, {}, `${MINUS}Rp${NBSP}35.000`],
    [0, {}, `Rp${NBSP}0`],
    [0, { sign: 'always' as const }, `Rp${NBSP}0`],
    [9500000, { sign: 'always' as const }, `+Rp${NBSP}9.500.000`],
    [-9500000, { sign: 'always' as const }, `${MINUS}Rp${NBSP}9.500.000`],
  ])('%s %o -> %s', (n, opts, expected) => {
    expect(formatRupiah(n, opts)).toBe(expected);
  });
});

describe('formatRupiahCompact', () => {
  it.each([
    [999, `Rp${NBSP}999`],
    [12500, `Rp${NBSP}12,5 rb`],
    [1250000, `Rp${NBSP}1,25 jt`],
    [1259999, `Rp${NBSP}1,25 jt`],
    [2000000, `Rp${NBSP}2 jt`],
    [1200000000, `Rp${NBSP}1,2 M`],
    [-1250000, `${MINUS}Rp${NBSP}1,25 jt`],
    [-1259999, `${MINUS}Rp${NBSP}1,25 jt`],
    [0, `Rp${NBSP}0`],
  ])('%s -> %s', (n, expected) => {
    expect(formatRupiahCompact(n)).toBe(expected);
  });
});

describe('parseRupiah', () => {
  it.each([
    ['35.000', 35000],
    ['35000', 35000],
    ['Rp 1.250.000', 1250000],
    [`Rp${NBSP}1.250.000`, 1250000],
    [' 1.250.000 ', 1250000],
    ['0', 0],
  ])('%j -> %s', (input, expected) => {
    expect(parseRupiah(input)).toBe(expected);
  });

  it.each([
    '-5000',
    '1e3',
    '12,5',
    '',
    'abc',
    '9007199254740993',
    '1.25',
    '1.2345',
    '35.000,50',
    'Rp',
  ])('%j -> null', (input) => {
    expect(parseRupiah(input)).toBeNull();
  });

  it('accepts MAX_SAFE_INTEGER', () => {
    expect(parseRupiah(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('roundtrips format -> parse for 0..10^13', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 ** 13 }), (n) => {
        expect(parseRupiah(formatRupiah(n))).toBe(n);
      }),
    );
  });
});

describe('spokenRupiah', () => {
  it('uses plain spaces and kind prefix', () => {
    expect(spokenRupiah(35000, 'expense')).toBe('pengeluaran Rp 35.000');
    expect(spokenRupiah(9500000, 'income')).toBe('pemasukan Rp 9.500.000');
    expect(spokenRupiah(1250000, 'neutral')).toBe('Rp 1.250.000');
  });
});
