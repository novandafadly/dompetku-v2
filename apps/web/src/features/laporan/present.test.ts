import { describe, expect, it } from 'vitest';
import {
  axisLabel,
  barHeightPct,
  bigNumberEm,
  budgetStatus,
  excludedLines,
  groupCategories,
  niceStep,
  pctText,
  trendAriaLabel,
  trendLabel,
  trendScale,
} from './present';
import type { CategorySummaryVM, TrendRowVM } from './types';

function cat(p: Partial<CategorySummaryVM>): CategorySummaryVM {
  return {
    kind: 'category',
    rootCategoryId: 'r1',
    categoryId: 'r1',
    type: 'expense',
    amount: 0,
    entryCount: 0,
    typeTotal: 1000,
    pct10: 0,
    rootTotal: 0,
    rootPct10: 0,
    pct10InRoot: 0,
    name: 'Makan',
    icon: 'fork-knife',
    archived: false,
    ...p,
  };
}

function trend(p: Partial<TrendRowVM>): TrendRowVM {
  return {
    labelMonth: '2026-10-01',
    from: '2026-09-25',
    to: '2026-10-22',
    pemasukan: 0,
    pengeluaran: 0,
    selisih: 0,
    complete: true,
    isCurrent: false,
    daysLeft: null,
    deltaPengeluaran: null,
    holidaysKnown: true,
    ...p,
  };
}

describe('pctText', () => {
  it('satu desimal koma, bulat tanpa desimal, nol = < 0,1% [T17]', () => {
    expect(pctText(378)).toBe('37,8%');
    expect(pctText(450)).toBe('45%');
    expect(pctText(1000)).toBe('100%');
    expect(pctText(5)).toBe('0,5%');
    expect(pctText(0)).toBe('< 0,1%');
  });
});

describe('budgetStatus', () => {
  it('tangga: ok < 80, near >= 80, tepat 100 = full (bukan Lewat), lewat = over', () => {
    expect(budgetStatus({ pct: 45, remaining: 100 })).toBe('ok');
    expect(budgetStatus({ pct: 80, remaining: 100 })).toBe('near');
    expect(budgetStatus({ pct: 100, remaining: 0 })).toBe('full');
    expect(budgetStatus({ pct: 104, remaining: -189_000 })).toBe('over');
  });
});

describe('sumbu tren', () => {
  it('langkah {1,2,2.5,4,5}x10^n pertama >= max/3 (puncak 12 jt -> langkah 4 jt)', () => {
    expect(niceStep(12_000_000)).toBe(4_000_000);
    expect(niceStep(7_000_000)).toBe(2_500_000);
    expect(niceStep(3_000_000)).toBe(1_000_000);
    expect(niceStep(0)).toBe(1);
  });
  it('label sumbu', () => {
    expect(axisLabel(0)).toBe('0');
    expect(axisLabel(500_000)).toBe('Rp 500 rb');
    expect(axisLabel(2_500_000)).toBe('Rp 2,5 jt');
    expect(axisLabel(12_000_000)).toBe('Rp 12 jt');
    expect(axisLabel(1_200_000_000)).toBe('Rp 1,2 M');
  });
  it('tinggi batang = nilai / puncak', () => {
    const s = trendScale([trend({ pemasukan: 12_000_000, pengeluaran: 6_000_000 })]);
    expect(s.top).toBe(12_000_000);
    expect(barHeightPct(6_000_000, s)).toBe(50);
    expect(barHeightPct(0, s)).toBe(0);
  });
  it('label periode: tahun hanya di Januari; aria-label menyebut tahun bila melintasi tahun', () => {
    expect(trendLabel('2026-10-01')).toBe('Okt');
    expect(trendLabel('2027-01-01')).toBe('Jan 2027');
    const a = trendAriaLabel([
      trend({ labelMonth: '2026-12-01' }),
      trend({ labelMonth: '2027-01-01', isCurrent: true }),
    ]);
    expect(a).toContain('Desember 2026 sampai Januari 2027');
    expect(a).toContain('Januari masih berjalan');
  });
  it('angka besar: pembagi digit 0,62 dan titik 0,28', () => {
    expect(bigNumberEm('1.250.000')).toBeCloseTo(7 * 0.62 + 2 * 0.28);
  });
});

describe('groupCategories', () => {
  it('induk + anak mengikuti urutan SQL; fee dan tanpa kategori kelompok sendiri', () => {
    const rows = [
      cat({ categoryId: 'r1', amount: 100, rootTotal: 300, typeTotal: 500 }),
      cat({ categoryId: 'c1', amount: 200, rootTotal: 300, typeTotal: 500, name: 'Anak' }),
      cat({ kind: 'fee', rootCategoryId: null, categoryId: null, amount: 200, typeTotal: 500 }),
      cat({ type: 'income', categoryId: 'i1', rootCategoryId: 'i1', typeTotal: 900 }),
    ];
    const e = groupCategories(rows, 'expense');
    expect(e.total).toBe(500);
    expect(e.groups.map((g) => g.root.kind)).toEqual(['category', 'fee']);
    expect(e.groups[0]?.children.map((c) => c.categoryId)).toEqual(['c1']);
    expect(groupCategories(rows, 'income').total).toBe(900);
  });
});

describe('excludedLines', () => {
  it('hanya arah yang tampil, > 0, nama per ruang, kelas asing = Lainnya', () => {
    const lines = excludedLines(
      [
        { reportClass: 'x_transfer', direction: 'out', amount: 40_000, entryCount: 1 },
        { reportClass: 'x_transfer', direction: 'in', amount: 40_000, entryCount: 1 },
        { reportClass: 'x_kantor', direction: 'in', amount: 5, entryCount: 1 },
        { reportClass: 'x_koreksi', direction: 'out', amount: 7, entryCount: 1 },
        { reportClass: 'x_baru', direction: 'in', amount: 9, entryCount: 1 },
        { reportClass: 'x_talangan', direction: 'out', amount: 0, entryCount: 0 },
      ],
      'bersama',
    );
    expect(lines.map((l) => l.name)).toEqual([
      'Transfer antar dompet',
      'Kas kantor · masuk',
      'Saldo awal dan koreksi · turun',
      'Lainnya',
    ]);
    expect(lines[0]?.note).toBe('Pindah antar dompet Bersama.');
  });
});

describe('excludedLines utang (S11)', () => {
  it('pokok dan pelunasan: nama per arah uang, tanpa Lainnya, tanpa "Hutang"', () => {
    const lines = excludedLines(
      [
        { reportClass: 'x_pelunasan_utang', direction: 'in', amount: 300_000, entryCount: 1 },
        { reportClass: 'x_pelunasan_utang', direction: 'out', amount: 200_000, entryCount: 2 },
        { reportClass: 'x_pokok_utang', direction: 'in', amount: 1_000_000, entryCount: 1 },
        { reportClass: 'x_pokok_utang', direction: 'out', amount: 500_000, entryCount: 1 },
      ],
      'pribadi',
    );
    expect(lines.map((l) => [l.key, l.name, l.amount])).toEqual([
      ['x_pelunasan_utang:in', 'Penerimaan piutang', 300_000],
      ['x_pelunasan_utang:out', 'Pelunasan utang', 200_000],
      ['x_pokok_utang:in', 'Pinjaman diterima', 1_000_000],
      ['x_pokok_utang:out', 'Pinjaman diberikan', 500_000],
    ]);
    for (const l of lines) {
      expect(l.name).not.toBe('Lainnya');
      expect(`${l.name} ${l.note}`).not.toMatch(/hutang/i);
    }
  });
});
