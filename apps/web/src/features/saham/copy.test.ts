import { describe, expect, it } from 'vitest';
import { cashOptions, latestOf } from './context';
import { gainSpoken, gainText, SAHAM_COPY as C, sharesLabel, sharesShort } from './copy';
import { equalsText, sharesOf } from './fields';

describe('salinan saham', () => {
  it('lembar dan lot: habis dibagi 100 menyebut lot, odd lot tanpa pecahan lot', () => {
    expect(sharesLabel(300)).toBe('300 lembar · 3 lot');
    expect(sharesLabel(250)).toBe('250 lembar');
    expect(sharesLabel(12_345_600)).toBe('12.345.600 lembar · 123.456 lot');
    expect(sharesShort(200)).toBe('2 lot');
    expect(sharesShort(250)).toBe('250 lembar');
  });

  it('baris transaksi: saham yang sudah dimiliki memakai istilah bingkai SH6 (S14-C3)', () => {
    expect(C.tradeLine('buy', 200, 9150)).toMatch(/^Beli 2 lot @ Rp\s9\.150$/);
    expect(C.tradeLine('opening', 250, 5000)).toMatch(/^Sudah dimiliki 250 lembar @ Rp\s5\.000$/);
  });

  it('untung/rugi selalu dengan tanda dan kata (minus U+2212), nol = Impas; bacaan layar tanpa simbol', () => {
    expect(gainText(195_000)).toMatch(/^\+Rp\s195\.000 untung$/);
    expect(gainText(-120_000)).toMatch(/^−Rp\s120\.000 rugi$/);
    expect(gainText(0)).toBe('Impas');
    expect(gainSpoken(195_000)).toMatch(/^ditambah Rp\s195\.000 untung$/);
    expect(gainSpoken(-120_000)).toMatch(/^dikurangi Rp\s120\.000 rugi$/);
    expect(C.unrealizedGain(0)).toBe('Belum terealisasi impas');
  });

  it('tidak ada kata terlarang dan tanda seru di salinan statis', () => {
    const texts: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') texts.push(v);
      else if (typeof v === 'function') {
        const f = v as (...a: never[]) => unknown;
        try {
          const out = (f as (...a: unknown[]) => unknown)('BBCA', 100, 9000, '2026-11-14', 'BCA');
          if (typeof out === 'string') texts.push(out);
        } catch {
          // fungsi dengan argumen lain tidak relevan untuk pemindaian kata
        }
      } else if (typeof v === 'object' && v !== null) Object.values(v).forEach(walk);
    };
    walk(C);
    const banned = /Portfolio|portofolio|P\/L|holding|ticker|unrealized|Net worth|!|rumah tangga/i;
    expect(texts.filter((t) => banned.test(t))).toEqual([]);
  });
});

describe('jumlah dan dompet kas', () => {
  it('sharesOf: lot x 100, lembar apa adanya, bukan angka bulat ≥ 1 = null', () => {
    expect(sharesOf('lot', '2')).toBe(200);
    expect(sharesOf('lembar', '250')).toBe(250);
    expect(sharesOf('lot', '')).toBeNull();
    expect(sharesOf('lot', '0')).toBeNull();
    expect(sharesOf('lembar', '1,5')).toBeNull();
    expect(equalsText('lot', 200)).toBe('= 200 lembar');
    expect(equalsText('lembar', 200)).toBe('= 2 lot');
    expect(equalsText('lembar', 250)).toBeNull();
    expect(equalsText('lot', null)).toBeNull();
  });

  it('cashOptions: hanya operasional/tabungan/trading aktif, trading lebih dulu; latestOf = tanggal terbesar', () => {
    const acc = (id: string, pocket: string, extra: object = {}) => ({
      id,
      name: id,
      pocket,
      walletType: 'bank',
      openedOn: '2026-11-01',
      archived: false,
      balance: 1,
      ...extra,
    });
    const out = cashOptions([
      acc('bca', 'operasional'),
      acc('kantor', 'kantor'),
      acc('emas', 'aset', { assetKind: 'emas' }),
      acc('rdn', 'trading'),
      acc('lama', 'operasional', { archived: true }),
      acc('tab', 'tabungan'),
      acc('pat', 'patungan'),
    ] as never);
    expect(out.map((o) => o.id)).toEqual(['rdn', 'bca', 'tab']);
    expect(latestOf('2026-11-01', null, '2026-11-10', undefined)).toBe('2026-11-10');
    expect(latestOf()).toBe('2020-01-01');
  });
});
