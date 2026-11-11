import { describe, expect, it } from 'vitest';
import { parseMessage, type DateSpec, type ParseResult } from './parse';

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
    // Miliar/triliun ditulis lengkap atau disingkat `mil`: gagal tertutup, bukan Rp2.
    ['2 miliar', 'bad_amount'],
    ['2 miliar rumah', 'bad_amount'],
    ['2 milyar', 'bad_amount'],
    ['2 mil', 'bad_amount'],
    ['2 mil.', 'bad_amount'],
    ['1 triliun', 'bad_amount'],
    ['1 trilyun', 'bad_amount'],
    ['2 Miliar', 'bad_amount'],
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
    ['5 meter', entry('expense', 5, 'personal', 'meter')],
    ['100 meja', entry('expense', 100, 'personal', 'meja')],
    // `mil` hanya sendirian; kata lain yang diawali `mil` tetap keterangan.
    ['3 milo', entry('expense', 3, 'personal', 'milo')],
    ['2 tri', entry('expense', 2, 'personal', 'tri')],
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
    '2 miliar',
    '2 milyar',
    '2 mil',
    '1 triliun',
    '1 trilyun',
  ];
  it.each(ADVERSARIAL)('%j tidak tercatat < Rp1.000', (input) => {
    const r = parse(input);
    if (r.kind === 'entry') expect(r.amount).toBeGreaterThanOrEqual(1000);
    else expect(r.kind).toBe('reject');
  });
});

describe('parseMessage: penanda dompet @nama', () => {
  const walletEntry = (
    description: string,
    wallet: string,
    over: Partial<Extract<ParseResult, { kind: 'entry' }>> = {},
  ): ParseResult => ({
    kind: 'entry',
    type: 'expense',
    amount: 23000,
    space: 'personal',
    description,
    wallet,
    ...over,
  });

  it.each<[string, ParseResult]>([
    ['makan siang padang 23rb @cimb', walletEntry('makan siang padang', 'cimb')],
    ['@cimb makan siang padang 23rb', walletEntry('makan siang padang', 'cimb')],
    ['makan siang @cimb padang 23rb', walletEntry('makan siang padang', 'cimb')],
    ['23rb @cimb', walletEntry('', 'cimb')],
    ['makan @CIMB 23rb', walletEntry('makan', 'cimb')],
    ['makan 23rb @cimb.', walletEntry('makan', 'cimb')],
    ['makan 23rb @cimb,', walletEntry('makan', 'cimb')],
    ['makan 23rb @bca-syariah', walletEntry('makan', 'bca-syariah')],
    ['makan 23rb @bca2', walletEntry('makan', 'bca2')],
    ['makan 23rb @kas_kantor', walletEntry('makan', 'kas_kantor')],
    ['makan 23rb @dompetku', walletEntry('makan', 'dompetku')],
    ['makan 23 rb @cimb', walletEntry('makan', 'cimb')],
    ['makan 23 @cimb rb', walletEntry('makan', 'cimb')], // penanda tidak memutus angka + satuan
    ['makan Rp @cimb 23.000', walletEntry('makan', 'cimb')],
    ['makan Rp @bca2 23.000', walletEntry('makan', 'bca2')],
    ['b 23rb makan @cimb', walletEntry('makan', 'cimb', { space: 'shared' })],
    ['makan bersama 23rb @cimb', walletEntry('makan', 'cimb', { space: 'shared' })],
    ['+23rb gaji @cimb', walletEntry('gaji', 'cimb', { type: 'income' })],
    ['makan 23rb @kantor', walletEntry('makan', 'kantor')],
  ])('%j', (input, expected) => {
    expect(parse(input)).toEqual(expected);
  });

  it('tanpa penanda: hasil tidak memuat kunci wallet', () => {
    const r = parse('25rb makan siang');
    expect(r).toEqual(entry('expense', 25000, 'personal', 'makan siang'));
    expect('wallet' in r).toBe(false);
  });

  it('@ yang bukan penanda tetap keterangan', () => {
    expect(parse('kirim ke budi@gmail.com 25rb')).toEqual(
      entry('expense', 25000, 'personal', 'kirim ke budi@gmail.com'),
    );
    expect(parse('25rb bayar @ warung')).toEqual(
      entry('expense', 25000, 'personal', 'bayar @ warung'),
    );
    expect(parse('25rb @')).toEqual(entry('expense', 25000, 'personal', '@'));
  });

  it('penanda tidak dibaca sebagai nominal atau satuan', () => {
    expect(parse('@k 25rb')).toEqual(walletEntry('', 'k', { amount: 25000 }));
    expect(parse('25 @rb')).toEqual(walletEntry('', 'rb', { amount: 25 }));
    expect(parse('@2 25rb')).toEqual(walletEntry('', '2', { amount: 25000 }));
  });

  it('dua penanda = many_wallets (gagal tertutup, juga bila sama)', () => {
    expect(parse('25rb makan @cimb @bca')).toEqual({ kind: 'reject', reason: 'many_wallets' });
    expect(parse('25rb makan @cimb @cimb')).toEqual({ kind: 'reject', reason: 'many_wallets' });
  });

  it.each(['25rb makan @cimb,x', '25rb makan @@cimb', '25rb makan @c!mb', '25rb makan @~cimb'])(
    '%j penanda rusak = bad_wallet',
    (input) => {
      expect(parse(input)).toEqual({ kind: 'reject', reason: 'bad_wallet' });
    },
  );

  it('penanda lebih panjang dari nama dompet (60) = bad_wallet, tanpa regex mahal', () => {
    expect(parse(`25rb makan @${'a'.repeat(60)}`)).toMatchObject({
      kind: 'entry',
      wallet: 'a'.repeat(60),
    });
    expect(parse(`25rb makan @${'a'.repeat(61)}`)).toEqual({
      kind: 'reject',
      reason: 'bad_wallet',
    });
    const t0 = performance.now();
    expect(parse(`25rb makan @${'.,'.repeat(30_000)}x`)).toEqual({
      kind: 'reject',
      reason: 'bad_wallet',
    });
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('galat nominal didahulukan dari galat penanda', () => {
    expect(parse('makan @cimb')).toEqual({ kind: 'reject', reason: 'no_amount' });
    expect(parse('makan 2 3 @cimb @bca')).toEqual({ kind: 'reject', reason: 'many_amounts' });
    expect(parse('makan 200jt @cimb')).toEqual({ kind: 'reject', reason: 'too_large' });
  });

  it('batal dan hubung tidak menerima penanda', () => {
    expect(parse('batal @cimb').kind).toBe('reject');
    expect(parse('hubung ABC123 @cimb').kind).toBe('reject');
  });
});

describe('parseMessage: tanggal', () => {
  const dated = (
    description: string,
    date: DateSpec,
    over: Partial<Extract<ParseResult, { kind: 'entry' }>> = {},
  ): ParseResult => ({
    kind: 'entry',
    type: 'expense',
    amount: 23000,
    space: 'personal',
    description,
    date,
    ...over,
  });
  const ago1 = { kind: 'ago', days: 1 } as const;

  it.each<[string, ParseResult]>([
    ['makan 23rb kemarin', dated('makan', ago1)],
    ['kemarin makan 23rb', dated('makan', ago1)],
    ['makan kmrn 23rb', dated('makan', ago1)],
    ['makan kemaren 23rb', dated('makan', ago1)],
    ['Makan 23rb KEMARIN.', dated('makan', ago1)],
    ['makan 23rb tgl 9', dated('makan', { kind: 'day', day: 9 })],
    ['makan 23rb tanggal 9', dated('makan', { kind: 'day', day: 9 })],
    ['tgl 09 makan 23rb', dated('makan', { kind: 'day', day: 9 })],
    ['makan 23rb tgl 9/11', dated('makan', { kind: 'dm', day: 9, month: 11 })],
    ['makan 23rb tgl 9-11', dated('makan', { kind: 'dm', day: 9, month: 11 })],
    ['makan 23rb tgl 9/11.', dated('makan', { kind: 'dm', day: 9, month: 11 })],
    ['makan 23rb tgl 9/11/2025', dated('makan', { kind: 'full', year: 2025, month: 11, day: 9 })],
    ['makan 23rb tgl 9-11-25', dated('makan', { kind: 'full', year: 2025, month: 11, day: 9 })],
    ['makan 23rb tgl 2025-11-09', dated('makan', { kind: 'full', year: 2025, month: 11, day: 9 })],
    ['makan 23rb 2025-11-09', dated('makan', { kind: 'full', year: 2025, month: 11, day: 9 })],
    ['makan 23rb tgl 9 nov', dated('makan', { kind: 'dm', day: 9, month: 11 })],
    ['makan 23rb tgl 9 November', dated('makan', { kind: 'dm', day: 9, month: 11 })],
    ['makan 23rb tgl 3 agu', dated('makan', { kind: 'dm', day: 3, month: 8 })],
    ['makan 23rb tgl 3 mei', dated('makan', { kind: 'dm', day: 3, month: 5 })],
    ['makan 23rb tgl 29/2', dated('makan', { kind: 'dm', day: 29, month: 2 })],
    ['makan tgl 9 23rb', dated('makan', { kind: 'day', day: 9 })],
    [
      'b 23rb makan tgl 9/11',
      dated('makan', { kind: 'dm', day: 9, month: 11 }, { space: 'shared' }),
    ],
    ['+23rb gaji tgl 25', dated('gaji', { kind: 'day', day: 25 }, { type: 'income' })],
    ['makan 23rb @cimb kemarin', dated('makan', ago1, { wallet: 'cimb' })],
  ])('%j', (input, expected) => {
    expect(parse(input)).toEqual(expected);
  });

  it('tahun sesudah nama bulan ditolak (bad_date), bukan dibaca sebagai nominal', () => {
    expect(parse('makan siang tgl 9 nov 2025')).toEqual({ kind: 'reject', reason: 'bad_date' });
    expect(parse('25rb makan tgl 9 nov 2025')).toEqual({ kind: 'reject', reason: 'bad_date' });
    expect(parse('25rb makan tgl 9 nov 1999')).toEqual({ kind: 'reject', reason: 'bad_date' });
    // angka lain sesudah bulan tetap nominal; YEAR_RE hanya persis 4 digit 19xx/20xx
    expect(parse('tgl 9 nov 2500')).toMatchObject({ amount: 2500 });
    expect(parse('tgl 9 nov 2025rb')).toMatchObject({ amount: 2_025_000 });
    expect(parse('tgl 9 2000')).toMatchObject({ amount: 2000, date: { kind: 'day', day: 9 } });
    expect(parse('tgl 9 2025')).toMatchObject({ amount: 2025, date: { kind: 'day', day: 9 } });
    expect(parse('2000 makan tgl 9 nov')).toMatchObject({
      amount: 2000,
      date: { kind: 'dm', day: 9, month: 11 },
    });
    expect(parse('tgl 9 nov 25000')).toMatchObject({
      amount: 25000,
      date: { kind: 'dm', day: 9, month: 11 },
    });
  });

  it('kemarin lusa / kemarin dulu = H-2; kata lain sesudah kemarin tetap keterangan', () => {
    expect(parse('makan 23rb kemarin lusa')).toEqual(dated('makan', { kind: 'ago', days: 2 }));
    expect(parse('makan 23rb kmrn dulu')).toEqual(dated('makan', { kind: 'ago', days: 2 }));
    expect(parse('makan 23rb kemarin siang')).toEqual(dated('makan siang', ago1));
  });

  it('nama bulan dicari sebagai properti sendiri (constructor, __proto__ bukan bulan)', () => {
    expect(parse('25rb tgl 5 constructor')).toEqual(
      dated('constructor', { kind: 'day', day: 5 }, { amount: 25000 }),
    );
    expect(parse('25rb tgl 5 __proto__')).toMatchObject({
      kind: 'entry',
      date: { kind: 'day', day: 5 },
    });
  });

  it('kata sesudah tgl-hari yang bukan bulan tetap keterangan', () => {
    expect(parse('makan 23rb tgl 9 xyz')).toEqual(dated('makan xyz', { kind: 'day', day: 9 }));
  });

  it('tanpa tanggal: tidak ada kunci date', () => {
    expect('date' in parse('25rb makan siang')).toBe(false);
  });

  it('angka tanggal tidak dihitung sebagai nominal', () => {
    expect(parse('tgl 9 25rb')).toMatchObject({ amount: 25000, date: { kind: 'day', day: 9 } });
    expect(parse('25rb tgl 9/11')).toMatchObject({ amount: 25000 });
    expect(parse('25 rb tgl 9/11')).toMatchObject({ amount: 25000 });
    expect(parse('tgl 9 25')).toMatchObject({ amount: 25, date: { kind: 'day', day: 9 } });
  });

  it('nominal sesudah tgl-hari tetap nominal, bukan bagian tanggal (tgl 9 2000 = Rp2000 tgl 9)', () => {
    expect(parse('tgl 9 2000')).toMatchObject({ amount: 2000, date: { kind: 'day', day: 9 } });
  });

  it('pecahan tanpa tgl bukan tanggal (gagal tertutup sebagai nominal)', () => {
    expect(parse('makan 1/2 porsi 25rb')).toEqual({ kind: 'reject', reason: 'many_amounts' });
    expect(parse('25rb makan 9/11').kind).toBe('reject');
  });

  it.each([
    'makan 23rb tgl',
    'makan 23rb tgl abc',
    'makan 23rb tgl 0',
    'makan 23rb tgl 32',
    'makan 23rb tgl 31/4',
    'makan 23rb tgl 30/2',
    'makan 23rb tgl 9/13',
    'makan 23rb tgl 9/0',
    'makan 23rb tgl 29/2/2025',
    'makan 23rb tgl 2025-02-30',
    'makan 23rb tgl 9/11/20255',
    'makan 23rb tgl 9//11',
    'makan 23rb tgl ' + 'a'.repeat(5000),
  ])('%j tanggal rusak = bad_date', (input) => {
    expect(parse(input)).toEqual({ kind: 'reject', reason: 'bad_date' });
  });

  it('dua tanggal = many_dates (juga bila sama)', () => {
    expect(parse('makan 23rb kemarin tgl 9')).toEqual({ kind: 'reject', reason: 'many_dates' });
    expect(parse('makan 23rb kemarin kmrn')).toEqual({ kind: 'reject', reason: 'many_dates' });
    expect(parse('makan 23rb tgl 9 tgl 9')).toEqual({ kind: 'reject', reason: 'many_dates' });
  });

  it('galat tanggal didahulukan dari galat nominal; batal/hubung tidak menerima tanggal', () => {
    expect(parse('makan kemarin')).toEqual({ kind: 'reject', reason: 'no_amount' });
    expect(parse('batal kemarin').kind).toBe('reject');
  });

  it('kata mirip bukan tanggal: tgl di dalam kata, kemarinan', () => {
    expect(parse('25rb mintgl 9')).toMatchObject({ kind: 'reject' });
    expect(parse('25rb kemarinan')).toEqual(entry('expense', 25000, 'personal', 'kemarinan'));
  });

  it('tidak lambat pada token panjang', () => {
    const t0 = performance.now();
    parse(`25rb tgl ${'.'.repeat(60_000)}`);
    parse(`25rb ${'9/'.repeat(30_000)}`);
    expect(performance.now() - t0).toBeLessThan(300);
  });
});
