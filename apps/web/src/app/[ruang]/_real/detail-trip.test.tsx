import { cleanup, render, screen } from '@testing-library/react';
import type { Route } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntryVM } from '@/features/ledger/types';
import { DetailReal } from './detail';

vi.mock('./detail-islands', () => ({
  DetailActionsIsland: () => null,
  RestoreIsland: () => null,
}));
vi.mock('./transaksi-islands', () => ({ RetryIsland: () => null }));

afterEach(cleanup);

const baseEntry: EntryVM = {
  id: 'e1',
  version: 1,
  kind: 'expense',
  occurredOn: '2026-12-13',
  createdAt: '2026-12-13T10:00:00+07:00',
  createdBy: { id: 'u1', name: 'Novanda', initial: 'N' },
  accountId: 'a1',
  accountName: 'BCA',
  amount: 120_000,
  categoryId: 'c1',
  categoryName: 'Makan',
  description: 'Hotel',
};

const renderDetail = (entry: EntryVM) =>
  render(
    <DetailReal
      ruang="pribadi"
      today="2026-12-14"
      me="u1"
      listHref={'/pribadi/transaksi' as Route}
      labels={{
        title: entry.description ?? 'Makan',
        category: 'Makan',
        amount: { value: -entry.amount, kind: 'expense' },
      }}
      data={{
        entry,
        history: [],
        accounts: [
          {
            id: 'a1',
            name: 'BCA',
            pocket: 'operasional',
            walletType: 'bank',
            openedOn: '2026-01-01',
            archived: false,
            balance: 1_000_000,
          },
        ],
        categories: [],
        restoreClosed: false,
        spaceCount: 2,
        talangan: null,
      }}
    />,
  );

describe('DetailReal: baris Trip (S15-TR17)', () => {
  it('menampilkan tautan ke Detail trip bila entri bertrip (aktif, terarsip, dan batal)', () => {
    const { rerender } = renderDetail({ ...baseEntry, tripId: 't1', tripName: 'Bali 2026' });
    const link = screen.getByRole('link', { name: 'Bali 2026' });
    expect(link).toHaveAttribute('href', '/pribadi/trip/t1');

    rerender(
      <DetailReal
        ruang="pribadi"
        today="2026-12-14"
        me="u1"
        listHref={'/pribadi/transaksi' as Route}
        labels={{ title: 'Hotel', category: 'Makan', amount: { value: -120_000, kind: 'expense' } }}
        data={{
          entry: {
            ...baseEntry,
            tripId: 't1',
            tripName: 'Bali 2026',
            tripArchived: true,
            voidedAt: '2026-12-14T11:00:00+07:00',
          },
          history: [],
          accounts: [],
          categories: [],
          restoreClosed: false,
          spaceCount: 1,
          talangan: null,
        }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Bali 2026 · Diarsipkan' })).toHaveAttribute(
      'href',
      '/pribadi/trip/t1',
    );
  });

  it('tidak menampilkan baris Trip bila entri tidak bertrip', () => {
    renderDetail(baseEntry);
    expect(screen.queryByText('Trip')).toBeNull();
  });
});
