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

  // Satuan terpisah dari angka (spasi di antaranya) tetap bagian nominal.
  it.each<[string, ParseResult]>([
    ['25 rb makan siang', entry('expense', 25000, 'personal', 'makan siang')],
    ['bensin 50 k', entry('expense', 50000, 'personal', 'bensin')],
    ['1 jt servis', entry('expense', 1000000, 'personal', 'servis')],
    ['1,5 jt gaji', entry('income', 1500000, 'personal', 'gaji')],
    ['25 ribu kopi', entry('expense', 25000, 'personal', 'kopi')],
    ['2 juta sewa', entry('expense', 2000000, 'personal', 'sewa')],
    ['25 RB kopi', entry('expense', 25000, 'personal', 'kopi')],
    ['Rp 25 rb kopi', entry('expense', 25000, 'personal', 'kopi')],
    ['+ 50 rb bonus', entry('income', 50000, 'personal', 'bonus')],
    ['b 80 rb belanja', entry('expense', 80000, 'shared', 'belanja')],
    // Satuan tanpa angka di depannya tetap keterangan.
    ['25rb rb kopi', entry('expense', 25000, 'personal', 'rb kopi')],
    ['kopi rb 25rb', entry('expense', 25000, 'personal', 'kopi rb')],
    ['k 25rb', entry('expense', 25000, 'personal', 'k')],
  ])('satuan terpisah %j', (input, expected) => {
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
    // Satuan terpisah: bukan satuan dikenal = angka bulat + keterangan; satuan dikenal tetap
    // tunduk pada aturan jumlah angka dan batas nominal.
    ['2 kopi 50 rb', 'many_amounts'],
    ['beli 2 kopi 50 rb', 'many_amounts'],
    ['200 jt x', 'too_large'],
    ['101 juta x', 'too_large'],
    ['1,25 rb x', 'bad_amount'],
    ['1.5.000 rb x', 'bad_amount'],
    // Salah ketik satuan sesudah angka ditolak, tidak dibaca sebagai Rp25 (sama dengan `25rbu`).
    ['25 rbu', 'bad_amount'],
    ['25 rbu kopi', 'bad_amount'],
    ['2 jutaan sewa', 'bad_amount'],
  ])('%j -> %s', (input, reason) => {
    expect(parse(input)).toEqual({ kind: 'reject', reason });
  });
});
