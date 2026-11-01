import { describe, expect, it } from 'vitest';
import { parseNominal } from './nominal';

describe('parseNominal', () => {
  it.each([
    ['35rb', 35_000],
    ['35 rb', 35_000],
    ['35ribu', 35_000],
    ['35k', 35_000],
    ['35K', 35_000],
    ['1,5jt', 1_500_000],
    ['1.5jt', 1_500_000],
    ['1,25 juta', 1_250_000],
    ['2jt', 2_000_000],
    ['35.000', 35_000],
    ['Rp 35.000', 35_000],
    ['Rp35.000', 35_000],
    ['35000', 35_000],
    ['35', 35],
    ['1,5rb', 1_500],
    ['0,5jt', 500_000],
    ['Rp 35rb', 35_000],
    [' 35RB ', 35_000],
  ])('parseNominal(%s) = %d', (s, n) => {
    expect(parseNominal(s)).toBe(n);
  });

  it.each([
    '',
    'abc',
    '-5000',
    '1e3',
    '1,2,3jt',
    '1,555rb',
    '35rbx',
    '9007199254740993',
    '1.5',
    'rb',
    '9007199254740991jt',
  ])('parseNominal(%s) = null', (s) => {
    expect(parseNominal(s)).toBeNull();
  });
});
