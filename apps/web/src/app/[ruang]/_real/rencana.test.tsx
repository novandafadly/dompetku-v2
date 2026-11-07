import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PeriodVM } from '@/features/ledger/types';
import type { BudgetOverviewVM, RencanaData } from '@/features/rencana/types';
import { RencanaFailed, RencanaReal } from './rencana';

afterEach(cleanup);

const host = vi.hoisted(() => vi.fn());
vi.mock('./rencana-islands', () => ({
  RencanaHostIsland: (props: { children: ReactNode }) => {
    host({ ...props, children: undefined });
    return <div data-testid="host">{props.children}</div>;
  },
  BudgetRowIsland: ({
    categoryId,
    className,
    children,
  }: {
    categoryId: string;
    className: string;
    children: ReactNode;
  }) => (
    <button type="button" data-budget-row={categoryId} className={className}>
      {children}
    </button>
  ),
  SetBudgetIsland: ({ label, className }: { label: string; className?: string }) => (
    <button type="button" className={className}>
      {label}
    </button>
  ),
  CopyBudgetsIsland: () => <button type="button">Salin anggaran periode lalu</button>,
  CopyConflictIsland: () => null,
}));
vi.mock('./transaksi-islands', () => ({
  RetryIsland: () => <button type="button">Coba lagi</button>,
}));
vi.mock('@/features/shell/page-header', () => ({
  PageHeader: ({ title, action }: { title: string; action?: ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {action}
    </header>
  ),
}));

const PERIOD: PeriodVM = {
  label: 'November 2026 · 23 Okt – 24 Nov',
  from: '2026-10-23',
  to: '2026-11-24',
  labelMonth: '2026-11-01',
  daysLeft: 20,
  holidaysKnown: true,
  basis: 'gajian',
};

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

const data = (over: Partial<RencanaData> = {}): RencanaData => ({
  period: PERIOD,
  previous: { labelMonth: '2026-10-01', budgetCount: 0, wajibCount: 0, amounts: {} },
  budgets: [],
  totals: { budget: 0, spent: 0, remaining: 0, pct: 0 },
  bills: [],
  due: [],
  upcoming: [],
  today: '2026-11-05',
  accounts: [],
  categories: [],
  ...over,
});

const BUDGETS = [
  row({
    categoryId: 'k-makan',
    name: 'Makan Siang & Minum',
    budget: 1_000_000,
    spent: 850_000,
    pct: 85,
    remaining: 150_000,
    wajib: true,
  }),
  row({
    categoryId: 'k-motor',
    name: 'Transportasi',
    budget: 500_000,
    spent: 100_000,
    pct: 20,
    remaining: 400_000,
  }),
  row({ categoryId: 'k-hiburan', name: 'Hiburan', spent: 75_000 }),
];

const bill = (over: Partial<RencanaData['bills'][number]> = {}): RencanaData['bills'][number] => ({
  billId: 'b1',
  name: 'Listrik PLN',
  amount: 485_000,
  categoryId: 'k-listrik-air',
  categoryName: 'Listrik & Air',
  rootCategoryId: 'k-listrik',
  accountId: null,
  accountName: null,
  dayOfMonth: 5,
  startsOn: '2026-01-01',
  endsOn: null,
  archived: false,
  nextDueOn: '2026-12-05',
  nextOccurrenceId: 'o1',
  ...over,
});

/** Teks dengan spasi (termasuk NBSP dari format Rupiah) dirapatkan. */
const flat = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ');

const view = (
  d: RencanaData,
  over: { ruang?: 'pribadi' | 'bersama'; bagian?: 'anggaran' | 'tagihan' } = {},
) =>
  render(
    <RencanaReal
      ruang={over.ruang ?? 'pribadi'}
      bagian={over.bagian ?? 'anggaran'}
      query=""
      data={d}
    />,
  );

describe('RencanaReal: daftar Anggaran (S9-AN1)', () => {
  it('judul periode, kartu total, Dianggarkan (urut persen), Belum dianggarkan, tombol Atur anggaran', () => {
    view(
      data({
        budgets: BUDGETS,
        totals: { budget: 1_500_000, spent: 950_000, remaining: 550_000, pct: 63 },
      }),
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Rencana' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'November 2026' })).toBeTruthy();
    expect(screen.getByText('23 Okt – 24 Nov · berjalan, 20 hari lagi')).toBeTruthy();
    const total = screen.getByRole('region', { name: /Terpakai/ });
    expect(flat(total)).toContain('dari Rp 1.500.000');
    const dianggarkan = screen.getByRole('region', { name: 'Dianggarkan' });
    const rows = within(dianggarkan).getAllByRole('button');
    expect(rows.map((r) => r.getAttribute('data-budget-row'))).toEqual(['k-makan', 'k-motor']);
    expect(rows[0]?.textContent).toContain('85% terpakai');
    expect(rows[0]?.textContent).toContain('Wajib');
    const belum = screen.getByRole('region', { name: 'Belum dianggarkan' });
    expect(within(belum).getAllByRole('button')).toHaveLength(1);
    expect(belum.textContent).toContain('Hiburan');
    expect(flat(belum)).toContain('Rp 75.000 periode ini');
    // Header laptop + dasar daftar (hidden/laptop:block diatur CSS).
    expect(screen.getAllByRole('button', { name: 'Atur anggaran' })).toHaveLength(2);
  });

  it('pulau mendapat bulan label, rentang, anggaran periode lalu, dan nama tagihan aktif per induk', () => {
    view(
      data({
        budgets: BUDGETS,
        previous: {
          labelMonth: '2026-10-01',
          budgetCount: 1,
          wajibCount: 0,
          amounts: { 'k-hiburan': 90_000 },
        },
        bills: [
          bill(),
          bill({ billId: 'b2', name: 'Lama', rootCategoryId: 'k-x', archived: true }),
        ],
      }),
    );
    expect(host).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ruang: 'pribadi',
        month: '2026-11',
        range: '23 Okt – 24 Nov',
        previous: { 'k-hiburan': 90_000 },
        billNameByRoot: { 'k-listrik': 'Listrik PLN' },
        rows: BUDGETS,
      }),
    );
  });

  it('semua kategori sudah dianggarkan: Belum dianggarkan memberi tahu, tanpa daftar', () => {
    view(data({ budgets: BUDGETS.filter((b) => b.budget !== null) }));
    const belum = screen.getByRole('region', { name: 'Belum dianggarkan' });
    expect(belum.textContent).toContain('Semua kategori sudah punya anggaran.');
    expect(within(belum).queryAllByRole('button')).toHaveLength(0);
  });

  it('kategori terarsip yang masih beranggaran tetap di Dianggarkan, tidak di Belum dianggarkan', () => {
    view(
      data({
        budgets: [
          ...BUDGETS,
          row({
            categoryId: 'k-lama',
            name: 'Lama',
            budget: 50_000,
            pct: 0,
            remaining: 50_000,
            archived: true,
          }),
        ],
      }),
    );
    const ids = within(screen.getByRole('region', { name: 'Dianggarkan' }))
      .getAllByRole('button')
      .map((r) => r.getAttribute('data-budget-row'));
    expect(ids).toContain('k-lama');
    expect(
      within(screen.getByRole('region', { name: 'Belum dianggarkan' })).queryByText('Lama'),
    ).toBeNull();
  });
});

describe('RencanaReal: tombol Atur anggaran (D4, M1)', () => {
  it('bawah daftar disembunyikan di laptop (header membawa aksi); keduanya hilang bila semua dianggarkan', () => {
    view(data({ budgets: BUDGETS }));
    const [header, bottom] = screen.getAllByRole('button', { name: 'Atur anggaran' });
    expect(header?.closest('header')).toBeTruthy();
    expect(bottom?.className).toContain('laptop:hidden');
    cleanup();
    view(data({ budgets: BUDGETS.filter((b) => b.budget !== null) }));
    expect(screen.queryByRole('button', { name: 'Atur anggaran' })).toBeNull();
  });

  it('periode baru: judul periode tampil di atas kartu catatan, satu tombol Atur anggaran', () => {
    view(
      data({
        budgets: BUDGETS.slice(2),
        previous: { labelMonth: '2026-10-01', budgetCount: 3, wajibCount: 1, amounts: { x: 1 } },
      }),
    );
    expect(screen.getByRole('heading', { level: 2, name: 'November 2026' })).toBeTruthy();
    expect(screen.getByText('23 Okt – 24 Nov · berjalan, 20 hari lagi')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Atur anggaran' })).toHaveLength(1);
  });
});

describe('RencanaReal: kosong = ajakan (S9-RC0)', () => {
  it('ruang tanpa anggaran dan tagihan: judul menyebut ruang, satu ajakan, tanpa Rp 0', () => {
    view(data({ budgets: [row({ categoryId: 'k1', name: 'Makan' })] }), { ruang: 'bersama' });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Belum ada rencana di Bersama.' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Atur anggaran pertama' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('Rp 0');
    expect(screen.queryByRole('region', { name: 'Dianggarkan' })).toBeNull();
  });

  it('punya tagihan tetapi belum anggaran: ajakan kecil bagian Anggaran + daftar kategori', () => {
    view(data({ budgets: BUDGETS.slice(2), bills: [bill()] }));
    expect(screen.getByRole('heading', { level: 2, name: 'Belum ada anggaran.' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Atur anggaran pertama' })).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Belum dianggarkan' })).getAllByRole('button'),
    ).toHaveLength(1);
  });

  it('periode baru kosong dengan anggaran periode lalu: kartu catatan + Salin + Atur anggaran', () => {
    view(
      data({
        budgets: BUDGETS.slice(2),
        previous: { labelMonth: '2026-10-01', budgetCount: 3, wajibCount: 1, amounts: { x: 1 } },
      }),
    );
    const note = screen.getByRole('region', { name: 'Anggaran periode lalu' });
    expect(note.textContent).toContain(
      'Periode ini belum punya anggaran. Periode lalu ada 3 anggaran.',
    );
    expect(note.textContent).toContain(
      'Anggaran wajib periode lalu belum ikut menghitung aman dipakai sampai diatur lagi.',
    );
    expect(within(note).getByRole('button', { name: 'Salin anggaran periode lalu' })).toBeTruthy();
    expect(within(note).getByRole('button', { name: 'Atur anggaran' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Atur anggaran pertama' })).toBeNull();
  });

  it('kalimat wajib hanya bila periode lalu punya anggaran wajib', () => {
    view(
      data({
        budgets: BUDGETS.slice(2),
        previous: { labelMonth: '2026-10-01', budgetCount: 2, wajibCount: 0, amounts: {} },
      }),
    );
    expect(document.body.textContent).not.toContain('Anggaran wajib periode lalu');
  });

  it('tombol Salin tidak tampil bila periode ini sudah punya anggaran, atau periode lalu kosong', () => {
    view(
      data({
        budgets: BUDGETS,
        previous: { labelMonth: '2026-10-01', budgetCount: 4, wajibCount: 0, amounts: {} },
      }),
    );
    expect(screen.queryByRole('button', { name: 'Salin anggaran periode lalu' })).toBeNull();
    cleanup();
    view(data({ budgets: BUDGETS.slice(2), bills: [bill()] }));
    expect(screen.queryByRole('button', { name: 'Salin anggaran periode lalu' })).toBeNull();
  });
});

describe('RencanaReal: segmen dan bagian Tagihan', () => {
  it('segmen tautan dengan aria-current pada bagian aktif; Tagihan membawa ?bagian=tagihan', () => {
    view(data({ budgets: BUDGETS }));
    const nav = screen.getByRole('navigation', { name: 'Bagian Rencana' });
    const [anggaran, tagihan] = within(nav).getAllByRole('link');
    expect(anggaran).toHaveAttribute('aria-current', 'page');
    expect(anggaran).toHaveAttribute('href', '/pribadi/rencana');
    expect(tagihan).not.toHaveAttribute('aria-current');
    expect(tagihan).toHaveAttribute('href', '/pribadi/rencana?bagian=tagihan');
    expect(nav.querySelector('[role="tablist"]')).toBeNull();
  });

  it('bagian Tagihan menandai Tagihan dan mempertahankan tema di tautan', () => {
    render(
      <RencanaReal
        ruang="bersama"
        bagian="tagihan"
        query="?theme=dark"
        data={data({ budgets: BUDGETS })}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Bagian Rencana' });
    const [anggaran, tagihan] = within(nav).getAllByRole('link');
    expect(tagihan).toHaveAttribute('aria-current', 'page');
    expect(anggaran).toHaveAttribute('href', '/bersama/rencana?theme=dark');
    expect(tagihan).toHaveAttribute('href', '/bersama/rencana?theme=dark&bagian=tagihan');
    expect(screen.queryByRole('region', { name: 'Dianggarkan' })).toBeNull();
  });
});

describe('RencanaFailed', () => {
  it('salinan tetap + Coba lagi, tanpa data', () => {
    render(<RencanaFailed />);
    expect(screen.getByRole('alert')).toHaveTextContent('Rencana belum bisa dimuat.');
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
  });
});
