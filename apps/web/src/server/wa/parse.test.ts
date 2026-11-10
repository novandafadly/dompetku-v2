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
    // Satuan terpisah dengan tanda baca atau akhiran menempel: gagal tertutup, bukan Rp25.
    ['25 rb, makan siang', 'bad_amount'],
    ['50 k.', 'bad_amount'],
    ['50 k,', 'bad_amount'],
    ['bensin 50 k!', 'bad_amount'],
    ['25 ribu.', 'bad_amount'],
    ['25 Rb.', 'bad_amount'],
    ['25 rb-an', 'bad_amount'],
    ['25 rb/porsi', 'bad_amount'],
    ['25 jt;', 'bad_amount'],
    ['25 juta?', 'bad_amount'],
    // Satuan lebar penuh (NFKC = `rb`/`k`) juga ditolak, sama dengan digit lebar penuh.
    ['25 ｒｂ', 'bad_amount'],
    ['25 ＲＢ kopi', 'bad_amount'],
    ['50 ｋ', 'bad_amount'],
    // Karakter format tak terlihat di depan satuan tidak meloloskan Rp25.
    ['25 ​rb kopi', 'bad_amount'],
    // Satuan slang (Jawa/Sunda: rebu, ewu) dan `m` (miliar) sendirian: gagal tertutup.
    ['25 rebu', 'bad_amount'],
    ['25 rebu makan siang', 'bad_amount'],
    ['25 rebuan', 'bad_amount'],
    ['25 ewu', 'bad_amount'],
    ['25 ewu bakso', 'bad_amount'],
    ['2 m', 'bad_amount'],
    ['2 m rumah', 'bad_amount'],
    ['2 m.', 'bad_amount'],
    ['2 M', 'bad_amount'],
    // Huruf mirip dari aksara lain (Kiril, Yunani) dan huruf beraksen: gagal tertutup.
    ['25 рб', 'bad_amount'],
    ['25 РБ kopi', 'bad_amount'],
    ['50 к', 'bad_amount'],
    ['50 К kopi', 'bad_amount'],
    ['2 м', 'bad_amount'],
    ['25 ребу', 'bad_amount'],
    ['25 еву', 'bad_amount'],
    ['50 κ', 'bad_amount'],
    ['25 ríbu', 'bad_amount'],
    ['25 rìbu kopi', 'bad_amount'],
    ['25 r̈b', 'bad_amount'],
    ['2 ĵt', 'bad_amount'],
    ['50 ḱ', 'bad_amount'],
  ])('%j -> %s', (input, reason) => {
    expect(parse(input)).toEqual({ kind: 'reject', reason });
  });
});

describe('parseMessage: satuan terpisah, batas aturan', () => {
  // Hanya token tepat sesudah angka yang dicek; satuan persis lalu kata keterangan biasa tetap
  // jalan, termasuk kata yang kebetulan diawali huruf satuan.
  it.each<[string, ParseResult]>([
    ['25 rb ketupat', entry('expense', 25000, 'personal', 'ketupat')],
    ['50 k kopi', entry('expense', 50000, 'personal', 'kopi')],
    ['50 k rbt', entry('expense', 50000, 'personal', 'rbt')],
    ['1 jt jutawan', entry('expense', 1000000, 'personal', 'jutawan')],
    ['25 rb rb.', entry('expense', 25000, 'personal', 'rb.')],
    // `k` diikuti huruf bukan satuan: angka bulat + keterangan (pilihan terdokumentasi).
    ['50 kopi', entry('expense', 50, 'personal', 'kopi')],
    ['50 ke pasar', entry('expense', 50, 'personal', 'ke pasar')],
    // `m` diikuti huruf bukan satuan (hanya `m` sendirian yang ditolak): kata keterangan biasa.
    ['2 mie', entry('expense', 2, 'personal', 'mie')],
    ['2 mie ayam 25 rb', { kind: 'reject', reason: 'many_amounts' }],
    ['25 rb mie ayam', entry('expense', 25000, 'personal', 'mie ayam')],
    ['3 martabak', entry('expense', 3, 'personal', 'martabak')],
    ['15 rb makan', entry('expense', 15000, 'personal', 'makan')],
    // Kata Kiril/aksen yang tidak diawali satuan tetap keterangan.
    ['5 кофе', entry('expense', 5, 'personal', 'кофе')],
    ['5 café', entry('expense', 5, 'personal', 'café')],
  ])('%j', (input, expected) => {
    expect(parse(input)).toEqual(expected);
  });

  // Properti: token mirip satuan tepat sesudah angka tidak pernah menghasilkan nominal < 1000.
  const ADVERSARIAL = [
    '25 rb,',
    '25 rb, makan',
    '25 rb.',
    '25 rb..',
    '25 rb!',
    '25 rb?',
    '25 rb:',
    '25 rb;',
    '25 rb-an',
    '25 rb/porsi',
    '25 rb)',
    '25 rb"',
    "25 rb'",
    '25 rbu',
    '25 rbx kopi',
    '25 ribu.',
    '25 ribuan',
    '25 rib',
    '25 jut',
    '2 jt.',
    '2 juta,',
    '2 jutaan',
    '50 k.',
    '50 k,',
    '50 k!',
    '50 k-an',
    '50 k2',
    '50 k)',
    '25 ｒｂ',
    '25 Ｒｂ.',
    '50 ｋ',
    '50 ｋ.',
    '25 ​rb',
    '25 ⁠k',
    'Rp 25 rb,',
    '+ 25 rb.',
    'b 25 rb, belanja',
    '1,5 jt.',
    '25 rebu',
    '25 rebuan',
    '25 ewu',
    '25 ewuan',
    '2 m',
    '2 m,',
    '25 рб',
    '25 рб.',
    '50 к',
    '50 к,',
    '2 м',
    '25 ríbu',
    '25 ŕb',
    '50 κ',
  ];
  it.each(ADVERSARIAL)('%j tidak tercatat < Rp1.000', (input) => {
    const r = parse(input);
    if (r.kind === 'entry') expect(r.amount).toBeGreaterThanOrEqual(1000);
    else expect(r.kind).toBe('reject');
  });
});
