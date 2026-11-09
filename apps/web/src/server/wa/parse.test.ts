import { describe, expect, it } from 'vitest';
import { parseMessage, type ParseResult } from './parse';

const MAX = 100_000_000;
const parse = (t: string) => parseMessage(t, { maxAmount: MAX });

const entry = (
  type: 'income' | 'expense',
  amount: number,
  space: 'personal' | 'shared',
  description: string,
): ParseResult => ({ kind: 'entry', type, amount, space, description });

describe('parseMessage: entry', () => {
  it.each<[string, ParseResult]>([
    ['25rb makan siang', entry('expense', 25000, 'personal', 'makan siang')],
    ['makan siang 25rb', entry('expense', 25000, 'personal', 'makan siang')],
    ['+5jt gaji', entry('income', 5000000, 'personal', 'gaji')],
    ['b 80rb belanja', entry('expense', 80000, 'shared', 'belanja')],
    ['Rp 25.000 kopi', entry('expense', 25000, 'personal', 'kopi')],
    ['Rp25rb kopi', entry('expense', 25000, 'personal', 'kopi')],
    ['25k kopi', entry('expense', 25000, 'personal', 'kopi')],
    ['1,5jt servis', entry('expense', 1500000, 'personal', 'servis')],
    ['1.5jt servis', entry('expense', 1500000, 'personal', 'servis')],
    ['KOPI 25000', entry('expense', 25000, 'personal', 'kopi')],
    ['25rb  makan   siang', entry('expense', 25000, 'personal', 'makan siang')],
    ['gaji 5jt', entry('income', 5000000, 'personal', 'gaji')],
    ['terima 200rb', entry('income', 200000, 'personal', 'terima')],
    ['masuk 200rb', entry('income', 200000, 'personal', 'masuk')],
    ['pemasukan 200rb', entry('income', 200000, 'personal', 'pemasukan')],
    ['+ 50rb bonus', entry('income', 50000, 'personal', 'bonus')],
    ['50rb belanja bersama', entry('expense', 50000, 'shared', 'belanja')],
    ['bersama 50rb listrik', entry('expense', 50000, 'shared', 'listrik')],
    ['25rb b kopi', entry('expense', 25000, 'personal', 'b kopi')],
    ['batal 25rb', entry('expense', 25000, 'personal', 'batal')],
    ['b 25rb', entry('expense', 25000, 'shared', '')],
  ])('%j', (input, expected) => {
    expect(parse(input)).toEqual(expected);
  });

  it('memangkas keterangan ke 200 karakter', () => {
    const r = parse(`25rb ${'a'.repeat(300)}`);
    expect(r.kind).toBe('entry');
    if (r.kind === 'entry') expect(r.description).toHaveLength(200);
  });
});

describe('parseMessage: cancel dan link', () => {
  it.each<[string, ParseResult]>([
    ['batal', { kind: 'cancel' }],
    ['  Batal ', { kind: 'cancel' }],
    ['hubung AB12CD', { kind: 'link', code: 'AB12CD' }],
    ['hubung ab12cd', { kind: 'link', code: 'AB12CD' }],
  ])('%j', (input, expected) => {
    expect(parse(input)).toEqual(expected);
  });
});

describe('parseMessage: reject', () => {
  it.each<[string, string]>([
    ['', 'empty'],
    ['   ', 'empty'],
    ['makan siang', 'no_amount'],
    ['beli 2 kopi 50rb', 'many_amounts'],
    ['jam 7 kopi 20rb', 'many_amounts'],
    ['0 kopi', 'bad_amount'],
    ['-5rb kopi', 'bad_amount'],
    ['1.5.000 x', 'bad_amount'],
    ['25rbu', 'bad_amount'],
    ['1e6 x', 'bad_amount'],
    ['1,25rb x', 'bad_amount'],
    ['Rp.25.00 x', 'bad_amount'],
    ['２５rb kopi', 'bad_amount'],
    ['٢٥٠٠٠ kopi', 'bad_amount'],
    ['200jt x', 'too_large'],
  ])('%j -> %s', (input, reason) => {
    expect(parse(input)).toEqual({ kind: 'reject', reason });
  });
});
