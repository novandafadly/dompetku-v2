import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BudgetOverviewVM } from '@/features/rencana/types';
import type { ReviewData } from '@/server/ledger/review';
import { ReviewFailed, ReviewLoadingPage, ReviewReal } from './review';

afterEach(cleanup);

const copyIsland = vi.hoisted(() => vi.fn());
vi.mock('./review-islands', () => ({
  ReviewCopyIsland: (props: unknown) => {
    copyIsland(props);
    return <div data-testid="copy-island" />;
  },
}));
vi.mock('./transaksi-islands', () => ({
  RetryIsland: () => <button type="button">Coba lagi</button>,
}));
vi.mock('@/features/shell/page-header', () => ({
  PageHeader: ({ title }: { title: string; action?: ReactNode }) => (
    <header>
      <h1>{title}</h1>
    </header>
  ),
}));

const row = (over: Partial<BudgetOverviewVM> & Pick<BudgetOverviewVM, 'categoryId' | 'name'>) =>
  ({
    icon: 'Tag',
    budget: null,
    wajib: false,
    spent: 0,
    pct: null,
    remaining: null,
    archived: false,
    parentId: null,
    subAllocated: null,
    maxAmount: null,
    ...over,
  }) satisfies BudgetOverviewVM;

const flat = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ');

const DATA: ReviewData = {
  period: {
    label: 'Oktober 2026 · 25 Sep – 22 Okt',
    from: '2026-09-25',
    to: '2026-10-22',
    labelMonth: '2026-10-01',
    holidaysKnown: true,
    basis: 'gajian',
    isCurrent: false,
    complete: true,
    daysLeft: null,
    prev: '2026-09',
    next: '2026-11',
  },
  summary: {
    pemasukan: 5_000_000,
    pengeluaran: 1_900_000,
    selisih: 3_100_000,
    deltaPengeluaran: -100_000,
    previous: { labelMonth: '2026-09-01', pengeluaran: 2_000_000 },
  },
  totals: { budget: 1_500_000, spent: 1_600_000, remaining: -100_000, pct: 106 },
  budgets: [
    row({
      categoryId: 'k-makan',
      name: 'Makan',
      budget: 1_000_000,
      spent: 1_200_000,
      pct: 120,
      remaining: -200_000,
      subAllocated: 300_000,
    }),
    row({
      categoryId: 'k-warteg',
      name: 'Warteg',
      parentId: 'k-makan',
      budget: 300_000,
      spent: 250_000,
      pct: 83,
      remaining: 50_000,
    }),
    row({
      categoryId: 'k-motor',
      name: 'Transportasi',
      budget: 500_000,
      spent: 400_000,
      pct: 80,
      remaining: 100_000,
    }),
  ],
  unbudgeted: [
    {
      kind: 'category',
      rootCategoryId: 'k-hobi',
      categoryId: 'k-hobi',
      type: 'expense',
      amount: 300_000,
      entryCount: 2,
      typeTotal: 1_900_000,
      pct10: 157,
      rootTotal: 300_000,
      rootPct10: 157,
      pct10InRoot: null,
      name: 'Hobi',
      icon: 'Tag',
      archived: false,
    },
  ],
  copy: { toMonth: '2026-11', count: 3 },
};

const view = (d: ReviewData = DATA) => render(<ReviewReal ruang="pribadi" query="" data={d} />);

describe('ReviewReal (S10-RV1)', () => {
  it('judul bulan, pemilih periode tanpa dasar periode, ringkasan Laporan, tautan periode ke Review', () => {
    view();
    expect(screen.getByRole('heading', { level: 1, name: 'Review Oktober 2026' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Dasar periode' })).toBeNull();
    const prev = screen.getByRole('link', { name: /^Periode sebelumnya/ });
    expect(prev.getAttribute('href')).toBe('/pribadi/rencana/review?periode=2026-09');
    const next = screen.getByRole('link', { name: /^Periode berikutnya/ });
    expect(next.getAttribute('href')).toBe('/pribadi/rencana/review?periode=2026-11');
    const ringkasan = screen.getByRole('region', { name: 'Pengeluaran Oktober 2026' });
    expect(flat(ringkasan)).toContain('Rp 1.900.000');
  });

  it('Rencana vs kenyataan: induk urut persen terbesar, rincian bersarang, tanpa tombol (baca saja)', () => {
    view();
    const list = screen.getByRole('region', { name: 'Rencana vs kenyataan' });
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
    const items = within(list).getAllByRole('listitem');
    expect(flat(items[0])).toContain('Makan');
    expect(flat(items[0])).toContain('Lewat Rp 200.000');
    expect(flat(items[0])).toContain('Dibagi ke 1 rincian · Rp 300.000');
    expect(within(list).getByRole('list', { name: 'Rincian Makan' })).toBeTruthy();
    expect(screen.getByRole('region', { name: /Terpakai/ })).toBeTruthy();
  });

  it('Tanpa anggaran: induk dengan pengeluaran dan nominal SQL; tautan Atur hanya di periode berjalan', () => {
    view();
    const tanpa = screen.getByRole('region', { name: 'Tanpa anggaran' });
    expect(flat(tanpa)).toContain('Hobi');
    expect(flat(tanpa)).toContain('Rp 300.000');
    expect(within(tanpa).queryByRole('link', { name: /Atur di Rencana/ })).toBeNull();
    cleanup();
    view({
      ...DATA,
      period: { ...DATA.period, isCurrent: true, complete: false, daysLeft: 5, next: null },
    });
    expect(
      within(screen.getByRole('region', { name: 'Tanpa anggaran' })).getByRole('link', {
        name: /Atur di Rencana/,
      }),
    ).toBeTruthy();
  });

  it('kartu Siapkan: pulau menerima bulan tujuan, judul periode dan jumlah baris; tanpa copy = tanpa pulau', () => {
    view();
    expect(copyIsland).toHaveBeenLastCalledWith({
      ruang: 'pribadi',
      toMonth: '2026-11',
      fromTitle: 'Oktober 2026',
      toTitle: 'November 2026',
      count: 3,
    });
    cleanup();
    view({ ...DATA, copy: null });
    expect(screen.queryByTestId('copy-island')).toBeNull();
  });

  it('tanpa anggaran: kartu catatan dengan tautan ke Rencana, ringkasan tetap tampil', () => {
    view({ ...DATA, budgets: [], unbudgeted: [], copy: null });
    expect(screen.getByText('Belum ada anggaran di periode ini.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ke Rencana' }).getAttribute('href')).toBe(
      '/pribadi/rencana?bagian=anggaran',
    );
    expect(screen.getByRole('region', { name: 'Pengeluaran Oktober 2026' })).toBeTruthy();
  });

  it('periode tanpa data dan tanpa anggaran: keadaan kosong', () => {
    view({
      ...DATA,
      budgets: [],
      unbudgeted: [],
      copy: null,
      summary: {
        ...DATA.summary,
        pemasukan: 0,
        pengeluaran: 0,
        selisih: 0,
        deltaPengeluaran: null,
      },
    });
    expect(screen.getByRole('heading', { name: 'Belum ada data di periode ini.' })).toBeTruthy();
  });
});

describe('Review gagal dan memuat', () => {
  it('gagal: salinan tetap + Coba lagi', () => {
    render(<ReviewFailed />);
    expect(screen.getByRole('heading', { name: 'Review belum bisa dimuat.' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
  });
  it('memuat: teks terlihat dengan role status', () => {
    render(<ReviewLoadingPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Memuat review…');
  });
});
