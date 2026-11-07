import type { Route } from 'next';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CategoryChartView } from './category-chart-view';
import { ClassBreakdownView } from './class-breakdown-view';
import { ContributionReportView } from './contribution-report-view';
import { PeriodPicker } from './period-picker';
import { SummaryCardView } from './summary-card-view';
import { TrendChartView } from './trend-chart-view';
import type {
  BudgetProgressVM,
  CategorySummaryVM,
  LaporanPeriodVM,
  LaporanSummaryVM,
  TrendRowVM,
} from './types';

vi.mock('@/components/ui/category-icon', () => ({
  CategoryGlyph: () => <span data-testid="glyph" />,
}));

afterEach(cleanup);
const norm = (s: string | null | undefined) => (s ?? '').replaceAll(' ', ' ');

const PERIOD: LaporanPeriodVM = {
  label: 'Oktober 2026 · 25 Sep – 22 Okt',
  from: '2026-09-25',
  to: '2026-10-22',
  labelMonth: '2026-10-01',
  holidaysKnown: true,
  basis: 'gajian',
  isCurrent: true,
  complete: false,
  daysLeft: 6,
  prev: '2026-09',
  next: null,
};
const SUMMARY: LaporanSummaryVM = {
  pemasukan: 8_000_000,
  pengeluaran: 5_000_000,
  selisih: 3_000_000,
  deltaPengeluaran: null,
  previous: { labelMonth: '2026-09-01', pengeluaran: 4_178_500 },
};

describe('PeriodPicker (S9-LP1)', () => {
  it('berjalan: > nonaktif (role img), < tautan; dasar periode nav + aria-current', () => {
    render(<PeriodPicker ruang="pribadi" period={PERIOD} query="" />);
    expect(screen.getByRole('img', { name: 'Periode berikutnya belum tersedia' })).toBeTruthy();
    const prev = screen.getByRole('link', { name: 'Periode sebelumnya: September 2026' });
    expect(prev.getAttribute('href')).toBe('/pribadi/laporan?periode=2026-09&basis=gajian');
    const dasar = screen.getByRole('navigation', { name: 'Dasar periode' });
    expect(
      within(dasar).getByRole('link', { name: 'Periode gajian' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.getByText('25 Sep – 22 Okt · berjalan, 6 hari lagi')).toBeTruthy();
    // Periode berjalan: berganti dasar tidak membawa bulan.
    expect(within(dasar).getByRole('link', { name: 'Bulan kalender' }).getAttribute('href')).toBe(
      '/pribadi/laporan?basis=kalender',
    );
  });
  it('lengkap membawa bulan saat ganti dasar; tema dibawa; petunjuk libur', () => {
    render(
      <PeriodPicker
        ruang="bersama"
        period={{
          ...PERIOD,
          isCurrent: false,
          complete: true,
          daysLeft: null,
          next: '2026-10',
          holidaysKnown: false,
          labelMonth: '2026-09-01',
        }}
        query="?theme=light"
      />,
    );
    const dasar = screen.getByRole('navigation', { name: 'Dasar periode' });
    expect(within(dasar).getByRole('link', { name: 'Bulan kalender' }).getAttribute('href')).toBe(
      '/bersama/laporan?theme=light&periode=2026-09&basis=kalender',
    );
    expect(screen.getByText(/· lengkap/)).toBeTruthy();
    // lengkap: petunjuk libur tidak tampil untuk periode lampau
    expect(screen.queryByText(/Libur nasional/)).toBeNull();
  });
});

describe('SummaryCardView', () => {
  it('Ringkasan: Pengeluaran besar, Pemasukan +, Selisih Surplus; periode berjalan tanpa pembanding', () => {
    render(
      <SummaryCardView
        ruang="pribadi"
        period={PERIOD}
        summary={SUMMARY}
        title="Oktober 2026"
        labelledBy="x"
      />,
    );
    const sec = screen.getByRole('region', { name: 'Pengeluaran Oktober 2026' });
    expect(norm(sec.textContent)).toContain('+Rp 8.000.000');
    expect(norm(sec.textContent)).toContain('−Rp 5.000.000');
    expect(norm(sec.textContent)).toContain('Surplus');
    expect(sec.textContent).toContain('Periode belum selesai; angka masih bisa bertambah.');
    expect(norm(sec.textContent)).toContain('September (lengkap): Rp 4.178.500');
  });
  it('Defisit memakai U+2212 dan Rp 0 polos; periode lengkap: pembanding dari SQL', () => {
    render(
      <SummaryCardView
        ruang="pribadi"
        period={{ ...PERIOD, isCurrent: false, complete: true, daysLeft: null }}
        summary={{ ...SUMMARY, pemasukan: 0, selisih: -5_000_000, deltaPengeluaran: -1_628_500 }}
        title="Oktober 2026"
        labelledBy="x"
      />,
    );
    const t = norm(screen.getByTestId('laporan-ringkasan').textContent);
    expect(t).toContain('Defisit');
    expect(t).toContain('Rp 0');
    expect(t).not.toContain('+Rp');
    expect(t).toContain('Rp 1.628.500 lebih sedikit dari September');
  });
});

describe('ClassBreakdownView', () => {
  it('tanpa baris tidak dirender', () => {
    const { container } = render(<ClassBreakdownView lines={[]} labelledBy="y" />);
    expect(container.innerHTML).toBe('');
  });
});

const BUDGET = (o: Partial<BudgetProgressVM>): BudgetProgressVM => ({
  categoryId: 'r1',
  amount: 180_000,
  wajib: false,
  spent: 153_000,
  pct: 85,
  remaining: 27_000,
  ...o,
});
const ROWS: CategorySummaryVM[] = [
  {
    kind: 'category',
    rootCategoryId: 'r1',
    categoryId: 'r1',
    type: 'expense',
    amount: 100_000,
    entryCount: 1,
    typeTotal: 400_000,
    pct10: 250,
    rootTotal: 300_000,
    rootPct10: 750,
    pct10InRoot: 333,
    name: 'Langganan',
    icon: 'film-slate',
    archived: false,
  },
  {
    kind: 'category',
    rootCategoryId: 'r1',
    categoryId: 'c1',
    type: 'expense',
    amount: 200_000,
    entryCount: 1,
    typeTotal: 400_000,
    pct10: 500,
    rootTotal: 300_000,
    rootPct10: 750,
    pct10InRoot: 667,
    name: 'Streaming',
    icon: 'film-slate',
    archived: false,
  },
  {
    kind: 'fee',
    rootCategoryId: null,
    categoryId: null,
    type: 'expense',
    amount: 100_000,
    entryCount: 1,
    typeTotal: 400_000,
    pct10: 250,
    rootTotal: 100_000,
    rootPct10: 250,
    pct10InRoot: null,
    name: null,
    icon: null,
    archived: null,
  },
];

describe('CategoryChartView', () => {
  it('induk dapat dibuka (details), persen dari SQL, Biaya transfer terakhir', () => {
    render(<CategoryChartView rows={ROWS} budgets={null} rencanaHref={null} labelledBy="k" />);
    const items = screen.getAllByTestId('laporan-kategori');
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector('details')).not.toBeNull();
    expect(norm(items[0]?.textContent)).toContain('75% dari pengeluaran');
    expect(norm(items[0]?.textContent)).toContain('66,7% dari Langganan');
    expect(items[1]?.textContent).toContain('Biaya transfer');
    expect(items[1]?.textContent).toContain('25% dari pengeluaran');
  });
  it('basis kalender (budgets null): catatan bahwa status anggaran hanya di Periode gajian (D3)', () => {
    render(<CategoryChartView rows={ROWS} budgets={null} rencanaHref={null} labelledBy="k" />);
    expect(screen.getByText(/Anggaran mengikuti periode gajian/)).toBeTruthy();
  });
  it('anggaran 85% = tautan 44 px ke Rencana dengan nama aksesibel memuat teks terlihat', () => {
    render(
      <CategoryChartView
        rows={ROWS}
        budgets={[BUDGET({})]}
        rencanaHref={'/pribadi/rencana?bagian=anggaran' as Route}
        labelledBy="k"
      />,
    );
    const link = screen.getByRole('link', { name: /85% terpakai/ });
    expect(norm(link.getAttribute('aria-label'))).toBe(
      'Langganan: dari anggaran Rp 180.000, 85% terpakai. Buka di Rencana.',
    );
    expect(link.getAttribute('href')).toBe('/pribadi/rencana?bagian=anggaran');
  });
  it('tepat 100% = Terpakai penuh (bukan Lewat Rp 0); lewat = Lewat Rp; < 80% teks; periode lengkap tanpa tautan', () => {
    const { rerender } = render(
      <CategoryChartView
        rows={ROWS}
        budgets={[BUDGET({ pct: 100, remaining: 0 })]}
        rencanaHref={'/x' as Route}
        labelledBy="k"
      />,
    );
    expect(screen.getByText('Terpakai penuh')).toBeTruthy();
    rerender(
      <CategoryChartView
        rows={ROWS}
        budgets={[BUDGET({ pct: 105, remaining: -9_000 })]}
        rencanaHref={'/x' as Route}
        labelledBy="k"
      />,
    );
    expect(norm(screen.getByRole('link').textContent)).toContain('Lewat Rp 9.000');
    rerender(
      <CategoryChartView
        rows={ROWS}
        budgets={[BUDGET({ pct: 45, remaining: 99 })]}
        rencanaHref={'/x' as Route}
        labelledBy="k"
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('45% terpakai')).toBeTruthy();
    rerender(
      <CategoryChartView rows={ROWS} budgets={[BUDGET({})]} rencanaHref={null} labelledBy="k" />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('85% terpakai')).toBeTruthy();
  });
});

const TREND: TrendRowVM[] = [
  {
    labelMonth: '2026-09-01',
    from: '2026-08-25',
    to: '2026-09-24',
    pemasukan: 10_000_000,
    pengeluaran: 4_000_000,
    selisih: 6_000_000,
    complete: true,
    isCurrent: false,
    daysLeft: null,
    deltaPengeluaran: null,
    holidaysKnown: true,
  },
  {
    labelMonth: '2026-10-01',
    from: '2026-09-25',
    to: '2026-10-22',
    pemasukan: 12_000_000,
    pengeluaran: 5_000_000,
    selisih: 7_000_000,
    complete: false,
    isCurrent: true,
    daysLeft: 6,
    deltaPengeluaran: null,
    holidaysKnown: true,
  },
];

describe('TrendChartView', () => {
  it('grafik role=img + tabel setara; berjalan ditandai; tinggi batang dari nilai SQL', () => {
    render(<TrendChartView rows={TREND} viewed="2026-10" labelledBy="t" />);
    expect(
      screen.getByRole('img', { name: /Grafik batang berpasangan.*Oktober masih berjalan/ }),
    ).toBeTruthy();
    const bars = document.querySelectorAll('[data-bar="expense"]');
    expect(bars).toHaveLength(2);
    expect(bars[1]?.getAttribute('data-value')).toBe('5000000');
    expect(screen.getAllByText('berjalan').length).toBeGreaterThan(0);
    const table = screen.getByTestId('laporan-tabel-tren');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(norm(table.textContent)).toContain('+Rp 7.000.000');
  });
  it('pembacaan langsung periode yang dilihat dari nilai SQL (D2)', () => {
    render(<TrendChartView rows={TREND} viewed="2026-10" labelledBy="t" />);
    const t = norm(screen.getByTestId('laporan-tren-langsung').textContent);
    expect(t).toContain('Okt · berjalan: Pemasukan');
    expect(t).toContain('Rp 12.000.000');
    expect(t).toContain('Rp 5.000.000');
  });
  it('satu periode: tanpa grafik, tabel langsung terbuka', () => {
    render(<TrendChartView rows={TREND.slice(1)} viewed="2026-10" labelledBy="t" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(document.querySelector('details')?.hasAttribute('open')).toBe(true);
  });
});

describe('ContributionReportView', () => {
  it('Belum ada setoran (bukan Setor Rp 0); Diambil hanya bila > 0', () => {
    render(
      <ContributionReportView
        labelledBy="c"
        vm={{
          rows: [
            {
              member: { id: 'a', name: 'Novanda', initial: 'N', role: 'owner' },
              setoran: 0,
              diambil: 0,
            },
            {
              member: { id: 'b', name: 'Farida', initial: 'F', role: 'member' },
              setoran: 500_000,
              diambil: 100_000,
            },
          ],
        }}
      />,
    );
    const t = norm(screen.getByTestId('laporan-kontribusi').textContent);
    expect(t).toContain('Belum ada setoran');
    expect(t).not.toContain('Setor Rp 0');
    expect(t).toContain('Setor Rp 500.000');
    expect(t).toContain('Diambil Rp 100.000');
  });
});
