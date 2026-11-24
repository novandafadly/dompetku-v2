import { cleanup, render, screen } from '@testing-library/react';
import type { Route } from 'next';
import { afterEach, describe, expect, it } from 'vitest';
import type { TripBreakdownVM, TripOverviewVM, TripVM } from '@/features/ledger/trip-types';
import type { EntryVM } from '@/features/ledger/types';
import {
  TripArchivedBanner,
  TripBreakdownCard,
  TripBudgetCard,
  TripCandidatesCard,
  TripEntriesCard,
  TripHero,
} from './trip-detail-views';
import { ArchivedTripRow, TripRow } from './trip-row';

afterEach(cleanup);

const baseTrip: TripOverviewVM = {
  id: 't1',
  name: 'Bali 2026',
  startsOn: '2026-12-12',
  endsOn: '2026-12-19',
  budget: 2_000_000,
  archived: false,
  phase: 'ongoing',
  dayCount: 8,
  elapsedDays: 3,
  spent: 900_000,
  entryCount: 4,
  perDay: 300_000,
  budgetLeft: 1_100_000,
  pct: 45,
  firstEntryOn: '2026-12-12',
  lastEntryOn: '2026-12-14',
};

const baseRow: TripVM = {
  id: 't1',
  name: 'Bali 2026',
  startsOn: '2026-12-12',
  endsOn: '2026-12-19',
  budget: 2_000_000,
  archived: false,
  phase: 'ongoing',
  dayCount: 8,
  spent: 900_000,
  entryCount: 4,
  budgetLeft: 1_100_000,
};

const sampleEntry = (over: Partial<EntryVM> = {}): EntryVM => ({
  id: 'e1',
  version: 1,
  kind: 'expense',
  occurredOn: '2026-12-13',
  createdAt: '2026-12-13T10:00:00+07:00',
  createdBy: { id: 'u1', name: 'Novanda', initial: 'N' },
  accountId: 'a1',
  accountName: 'BCA',
  amount: 250_000,
  categoryId: 'c1',
  categoryName: 'Makan',
  description: 'Nasi campur',
  tripId: 't1',
  tripName: 'Bali 2026',
  ...over,
});

describe('TripRow & ArchivedTripRow (S15-TR3)', () => {
  it('total 0 menampilkan Belum ada pengeluaran tanpa Rp 0; kelebihan anggaran pakai Lebih', () => {
    const { container } = render(
      <ul>
        <TripRow
          trip={{ ...baseRow, id: 't0', spent: 0, entryCount: 0, budgetLeft: 2_000_000 }}
          href={'/pribadi/trip/t0' as Route}
        />
        <TripRow
          trip={{ ...baseRow, id: 't2', spent: 2_500_000, budgetLeft: -500_000 }}
          href={'/pribadi/trip/t2' as Route}
        />
        <ArchivedTripRow
          trip={{ ...baseRow, id: 't3', archived: true }}
          href={'/pribadi/trip/t3' as Route}
          restore={<button type="button">Pulihkan</button>}
        />
      </ul>,
    );
    expect(screen.getByText('Belum ada pengeluaran')).toBeVisible();
    expect(container.textContent).not.toContain('Rp 0');
    expect(screen.getByText('Lebih Rp 500.000')).toBeVisible();
    // Tombol Pulihkan di luar tautan.
    const restoreBtn = screen.getByRole('button', { name: 'Pulihkan' });
    expect(restoreBtn.closest('a')).toBeNull();
  });
});

describe('TripHero & TripBudgetCard (S15-TR5, TR6, TR10)', () => {
  it('menampilkan total, fase berlangsung, rata-rata, dan progressbar anggaran (normal & lebih)', () => {
    const { rerender } = render(
      <>
        <TripHero trip={baseTrip} ruang="pribadi" titleId="h1" />
        <TripBudgetCard trip={baseTrip} ruang="pribadi" />
      </>,
    );
    expect(screen.getByTestId('trip-total')).toHaveTextContent('Rp 900.000');
    expect(screen.getByText('Berlangsung · hari ke 3 dari 8')).toBeVisible();
    expect(screen.getByText('Rata-rata Rp 300.000 per hari')).toBeVisible();
    const bar = screen.getByRole('progressbar', { name: 'Anggaran trip' });
    expect(bar).toHaveAttribute('aria-valuenow', '45');
    expect(screen.getByText('Sisa Rp 1.100.000')).toBeVisible();

    // Kelebihan anggaran (112%): bilah berhenti di 100, teks 112% dan Lebih Rp ...
    const over: TripOverviewVM = {
      ...baseTrip,
      spent: 2_240_000,
      budgetLeft: -240_000,
      pct: 112,
    };
    rerender(<TripBudgetCard trip={over} ruang="bersama" />);
    expect(screen.getByRole('progressbar', { name: 'Anggaran trip' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    expect(screen.getByText('112%')).toBeVisible();
    expect(screen.getByText('Lebih Rp 240.000')).toBeVisible();
  });

  it('total 0 tidak menampilkan Rp 0 atau Sisa; pct 0 dengan spent > 0 = Kurang dari 1%', () => {
    const { container, rerender } = render(
      <>
        <TripHero
          trip={{
            ...baseTrip,
            spent: 0,
            entryCount: 0,
            perDay: null,
            budgetLeft: 2_000_000,
            pct: 0,
          }}
          ruang="pribadi"
          titleId="h1"
        />
        <TripBudgetCard
          trip={{
            ...baseTrip,
            spent: 0,
            entryCount: 0,
            perDay: null,
            budgetLeft: 2_000_000,
            pct: 0,
          }}
          ruang="pribadi"
        />
      </>,
    );
    expect(screen.getByText('Belum ada pengeluaran di trip ini')).toBeVisible();
    expect(container.textContent).not.toContain('Rp 0');
    expect(container.textContent).not.toContain('Sisa Rp');

    rerender(
      <TripBudgetCard
        trip={{ ...baseTrip, spent: 5_000, budget: 2_000_000, budgetLeft: 1_995_000, pct: 0 }}
        ruang="pribadi"
      />,
    );
    expect(screen.getByText('Kurang dari 1%')).toBeVisible();
  });

  it('banner terarsip menampilkan tombol Pulihkan', () => {
    render(<TripArchivedBanner restore={<button type="button">Pulihkan</button>} />);
    expect(screen.getByText('Trip ini diarsipkan.')).toBeVisible();
  });
});

describe('TripBreakdownCard, TripCandidatesCard, TripEntriesCard (S15-TR7..TR9)', () => {
  const breakdown: TripBreakdownVM = {
    category: [{ key: 'c1', label: 'Makan', amount: 900_000, entryCount: 2 }],
    day: [
      { key: '2026-12-13', label: '2026-12-13', amount: 600_000, entryCount: 1 },
      { key: '2026-12-01', label: '2026-12-01', amount: 300_000, entryCount: 1 },
    ],
    member: [
      { key: 'u1', label: 'Novanda', amount: 600_000, entryCount: 1, isMe: true },
      { key: 'u2', label: 'Farida', amount: 300_000, entryCount: 1 },
    ],
  };

  it('Dicatat oleh hanya tampil bila memberCount >= 2; hari di luar rentang bertanda Di luar tanggal trip', () => {
    const { rerender } = render(
      <TripBreakdownCard trip={baseTrip} breakdown={breakdown} memberCount={1} />,
    );
    expect(screen.queryByText('Dicatat oleh')).toBeNull();
    // Per hari terlipat bawaan: buka dulu baru terlihat.
    const perHari = screen.getByText('Per hari (2 hari)').closest('details');
    expect(perHari).not.toBeNull();
    if (perHari !== null) perHari.open = true;
    expect(screen.getByText('Di luar tanggal trip')).toBeVisible();

    rerender(<TripBreakdownCard trip={baseTrip} breakdown={breakdown} memberCount={2} />);
    expect(screen.getByText('Dicatat oleh')).toBeVisible();
    expect(screen.getByText('Kamu')).toBeVisible();
    expect(screen.getByText('Farida')).toBeVisible();
  });

  it('TripEntriesCard: baris patungan tanpa tombol Keluarkan dan bertanda Dari patungan; catatan terpotong', () => {
    render(
      <>
        <TripCandidatesCard
          trip={baseTrip}
          candidates={[
            {
              entryId: 'c1',
              occurredOn: '2026-12-13',
              description: 'Kopi',
              categoryName: 'Makan',
              accountName: 'BCA',
              amount: 25_000,
            },
          ]}
          candidatesMore
          openImport={<button type="button">Masukkan 1 pengeluaran</button>}
        />
        <TripEntriesCard
          trip={baseTrip}
          entries={[
            sampleEntry({ id: 'e1', description: 'Nasi campur' }),
            sampleEntry({
              id: 'e2',
              description: 'Makan malam',
              split: { role: 'bill', payerName: 'Novanda' },
            }),
          ]}
          entriesTruncated
          hasCandidates={false}
          today="2026-12-14"
          headingId="entries-h2"
          entryHref={(id) => `/bersama/transaksi/${id}` as Route}
          removeEntry={(_e, title) => (
            <button type="button" aria-label={`Keluarkan dari trip: ${title}`}>
              x
            </button>
          )}
        />
      </>,
    );
    expect(screen.getByText('Masih ada yang lain. Ulangi sesudah ini.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Keluarkan dari trip: Nasi campur' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Makan malam/ })).toBeNull();
    expect(screen.getByText('Dari patungan')).toBeVisible();
    expect(
      screen.getByText(
        'Menampilkan 200 pengeluaran terbaru. Rincian di atas dihitung dari semua pengeluaran trip.',
      ),
    ).toBeVisible();
  });
});
