import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntryVM, TrashVM } from '@/features/ledger/types';
import { TrashListReal } from './sampah-client';

afterEach(cleanup);

const mocks = vi.hoisted(() => ({
  entri: vi.fn(),
  saham: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('../_actions/entri', () => ({ restoreEntryAction: mocks.entri }));
vi.mock('../_actions/saham', () => ({ restoreStockTradeAction: mocks.saham }));
vi.mock('@/components/ui/toast', () => ({ toast: vi.fn() }));

const base: EntryVM = {
  id: 'e1',
  version: 2,
  kind: 'expense',
  occurredOn: '2026-11-01',
  createdAt: '2026-11-01T08:00:00+07:00',
  createdBy: { id: 'u', name: 'Novanda', initial: 'N' },
  accountId: 'a1',
  accountName: 'BCA',
  amount: 25_000,
  description: 'Nasi padang',
  voidedAt: '2026-11-02T09:00:00+07:00',
};
const tradeEntry: EntryVM = {
  ...base,
  id: 'e2',
  kind: 'transfer',
  amount: 1_830_000,
  description: undefined as never,
  counterAccountId: 'sk1',
  counterAccountName: 'Ajaib',
  trade: {
    id: 't1',
    ticker: 'BBCA',
    side: 'buy',
    shares: 200,
    accountId: 'sk1',
    accountName: 'Ajaib',
  },
};
const items: TrashVM[] = [
  { entry: tradeEntry, purgeAfter: '2027-01-31T09:00:00+07:00' },
  { entry: base, purgeAfter: '2027-01-31T09:00:00+07:00' },
];

const render1 = () =>
  render(<TrashListReal ruang="pribadi" today="2026-11-02" items={items} accounts={[]} />);

describe('TrashListReal: transaksi saham (S14-AS7)', () => {
  it('baris trade: Beli {kode}, jenis Beli saham; baris biasa tetap', () => {
    render1();
    expect(screen.getByText('Beli BBCA · 200 lembar')).toBeTruthy();
    expect(screen.getByText(/Beli saham · BCA → Ajaib/)).toBeTruthy();
    expect(screen.getByText('Nasi padang')).toBeTruthy();
  });

  it('Pulihkan trade = restoreStockTradeAction dengan id trade; entri biasa = restoreEntryAction', async () => {
    mocks.saham.mockResolvedValue({ ok: true, value: { tradeId: 't1' } });
    mocks.entri.mockResolvedValue({ ok: true, value: { version: 3 } });
    render1();
    const pulih = (i: number) => {
      const b = screen.getAllByRole('button', { name: /^Pulihkan/ })[i];
      if (!b) throw new Error('tombol tidak ada');
      return b;
    };
    fireEvent.click(pulih(0));
    await waitFor(() => {
      expect(mocks.saham).toHaveBeenCalledTimes(1);
    });
    expect(mocks.saham).toHaveBeenCalledWith(
      'pribadi',
      expect.objectContaining({ tradeId: 't1', allowNegative: false }),
    );
    expect(mocks.entri).not.toHaveBeenCalled();
    fireEvent.click(pulih(1));
    await waitFor(() => {
      expect(mocks.entri).toHaveBeenCalledTimes(1);
    });
  });

  it('trade_not_latest: salinan di baris menyebut kode, tanpa nominal', async () => {
    mocks.saham.mockResolvedValue({ ok: false, error: { code: 'trade_not_latest' } });
    render1();
    fireEvent.click(screen.getAllByRole('button', { name: /^Pulihkan/ })[0] ?? document.body);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Urutan transaksi BBCA sudah berubah');
    expect(alert.textContent).not.toMatch(/Rp|server/);
  });
});
