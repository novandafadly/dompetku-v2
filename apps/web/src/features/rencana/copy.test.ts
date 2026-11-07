import { describe, expect, it } from 'vitest';
import type { PeriodVM } from '@/features/ledger/types';
import {
  budgetedRows,
  budgetLevel,
  obligationDoubleBudgetText,
  periodSubtitle,
  RENCANA_COPY,
  splitPeriodLabel,
  unbudgetedRows,
} from './copy';
import type { BudgetOverviewVM } from './types';

const row = (over: Partial<BudgetOverviewVM> & Pick<BudgetOverviewVM, 'categoryId' | 'name'>) =>
  ({
    icon: 'Tag',
    budget: null,
    wajib: false,
    spent: 0,
    pct: null,
    remaining: null,
    archived: false,
    ...over,
  }) satisfies BudgetOverviewVM;

const PERIOD: PeriodVM = {
  label: 'November 2026 · 23 Okt – 24 Nov',
  from: '2026-10-23',
  to: '2026-11-24',
  labelMonth: '2026-11-01',
  daysLeft: 20,
  holidaysKnown: true,
  basis: 'gajian',
};

describe('periode', () => {
  it('memisah judul dan rentang; tanpa pemisah = judul saja', () => {
    expect(splitPeriodLabel(PERIOD.label)).toEqual({
      title: 'November 2026',
      range: '23 Okt – 24 Nov',
    });
    expect(splitPeriodLabel('November 2026')).toEqual({ title: 'November 2026', range: '' });
  });

  it('subjudul menyebut sisa hari', () => {
    expect(periodSubtitle(PERIOD)).toBe('23 Okt – 24 Nov · berjalan, 20 hari lagi');
    expect(periodSubtitle({ ...PERIOD, label: 'November 2026' })).toBe('berjalan, 20 hari lagi');
  });
});

describe('budgetLevel (tangga status AN1)', () => {
  it('79% ok, 80% near, tepat 100% full, lewat over', () => {
    expect(budgetLevel({ pct: 79, remaining: 21 })).toBe('ok');
    expect(budgetLevel({ pct: 80, remaining: 20 })).toBe('near');
    expect(budgetLevel({ pct: 99, remaining: 1 })).toBe('near');
    expect(budgetLevel({ pct: 100, remaining: 0 })).toBe('full');
    expect(budgetLevel({ pct: 100, remaining: -1 })).toBe('over');
    expect(budgetLevel({ pct: 250, remaining: -300 })).toBe('over');
  });

  it('belum dianggarkan (null) dianggap ok', () => {
    expect(budgetLevel({ pct: null, remaining: null })).toBe('ok');
  });
});

describe('daftar dan total', () => {
  const rows = [
    row({
      categoryId: 'a',
      name: 'Transportasi',
      budget: 1_000,
      spent: 500,
      pct: 50,
      remaining: 500,
    }),
    row({ categoryId: 'b', name: 'Belanja', budget: 1_000, spent: 900, pct: 90, remaining: 100 }),
    row({ categoryId: 'c', name: 'Hiburan' }),
    row({ categoryId: 'd', name: 'Kesehatan', budget: 400, spent: 400, pct: 100, remaining: 0 }),
    row({
      categoryId: 'e',
      name: 'Arsip',
      budget: 100,
      spent: 10,
      pct: 10,
      remaining: 90,
      archived: true,
    }),
    row({ categoryId: 'f', name: 'Alfa', budget: 100, spent: 50, pct: 50, remaining: 50 }),
  ];

  it('Dianggarkan urut persentase terbesar lalu nama; terarsip yang masih beranggaran ikut', () => {
    expect(budgetedRows(rows).map((r) => r.name)).toEqual([
      'Kesehatan',
      'Belanja',
      'Alfa',
      'Transportasi',
      'Arsip',
    ]);
  });

  it('Belum dianggarkan hanya kategori aktif tanpa anggaran', () => {
    expect(unbudgetedRows(rows).map((r) => r.name)).toEqual(['Hiburan']);
  });
});

describe('salinan', () => {
  it('obligation_double menyebut nama tagihan bila ada, tanpa nominal', () => {
    expect(obligationDoubleBudgetText('Listrik PLN')).toBe(
      'Kategori ini sudah punya tagihan Listrik PLN. Satu kewajiban cukup dicatat sekali: arsipkan tagihannya atau jadikan anggaran ini tidak wajib.',
    );
    expect(obligationDoubleBudgetText(undefined)).toMatch(/^Kategori ini sudah punya tagihan\. /);
  });

  it('toast salin: jumlah, ruang, dan yang dilewati', () => {
    expect(RENCANA_COPY.copied(3, 'bersama', 0)).toBe('3 anggaran disalin ke Bersama');
    expect(RENCANA_COPY.copied(3, 'pribadi', 2)).toBe('3 anggaran disalin ke Pribadi · 2 dilewati');
  });
});
