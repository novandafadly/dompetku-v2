import { render, screen } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it, vi } from 'vitest';
import type { AccountVM, EntryVM } from '@/features/ledger/types';
import { DetailFailed, DetailReal, detailAbilities } from './detail';

vi.mock('./detail-islands', () => ({
  DetailActionsIsland: ({ editable, voidable }: { editable: boolean; voidable: boolean }) => (
    <div>
      {editable ? <button type="button">Ubah</button> : null}
      {voidable ? <button type="button">Batalkan transaksi</button> : null}
    </div>
  ),
  RestoreIsland: () => <button type="button">Pulihkan</button>,
}));
vi.mock('./transaksi-islands', () => ({
  RetryIsland: () => <button type="button">Coba lagi</button>,
}));

const TODAY = '2026-11-02';

const ACCOUNT: AccountVM = {
  id: 'acc-1',
  name: 'BCA',
  pocket: 'operasional',
  walletType: 'bank',
  openedOn: '2026-10-28',
  archived: false,
  balance: 100_000,
};

function entry(over: Partial<EntryVM> = {}): EntryVM {
  return {
    id: 'e1',
    version: 2,
    kind: 'expense',
    occurredOn: TODAY,
    createdAt: '2026-11-02T08:00:00+07:00',
    createdBy: { id: 'u-n', name: 'Novanda', initial: 'N' },
    accountId: 'acc-1',
    accountName: 'BCA',
    amount: 25_000,
    categoryName: 'Makan',
    description: 'Nasi padang',
    ...over,
  };
}

const data = (e: EntryVM, restoreClosed = false) => ({
  entry: e,
  history: [],
  accounts: [ACCOUNT],
  categories: [],
  restoreClosed,
});

const labels = {
  title: 'Nasi padang',
  category: 'Makan',
  amount: { value: -25_000, kind: 'expense' as const },
};

const props = { ruang: 'pribadi' as const, today: TODAY, listHref: '/pribadi/transaksi' as Route };

describe('detailAbilities (sesuai api.update_entry / void_entry)', () => {
  const ab = (e: EntryVM, accounts = [ACCOUNT], today = TODAY) =>
    detailAbilities(e, { accounts }, today);

  it('pemasukan/pengeluaran hidup: Ubah dan Batalkan', () => {
    expect(ab(entry())).toEqual({ editable: true, voidable: true });
    expect(ab(entry({ kind: 'income' }))).toEqual({ editable: true, voidable: true });
  });

  it('transfer dan cocokkan saldo: hanya Batalkan (api.update_entry menolak kind_not_editable)', () => {
    expect(ab(entry({ kind: 'transfer', counterAccountName: 'Tunai' }))).toEqual({
      editable: false,
      voidable: true,
    });
    expect(ab(entry({ kind: 'adjustment', direction: 'in' }))).toEqual({
      editable: false,
      voidable: true,
    });
  });

  it('saldo awal: Ubah (nominal) hanya ≤ 7 hari sejak dompet dibuka, tidak pernah Batalkan', () => {
    const opening = entry({ kind: 'opening_balance' });
    expect(ab(opening, [ACCOUNT], '2026-11-04')).toEqual({ editable: true, voidable: false });
    expect(ab(opening, [ACCOUNT], '2026-11-05')).toEqual({ editable: false, voidable: false });
  });

  it('antar ruang (S7) dan entri batal: tanpa aksi', () => {
    expect(ab(entry({ kind: 'space_transfer', direction: 'out' }))).toEqual({
      editable: false,
      voidable: false,
    });
    expect(ab(entry({ voidedAt: '2026-11-02T09:00:00+07:00' }))).toEqual({
      editable: false,
      voidable: false,
    });
  });
});

describe('DetailReal', () => {
  it('hidup: Ubah dan Batalkan, tanpa Pindahkan ke ruang lain (S7); dicatat oleh kamu', () => {
    render(<DetailReal {...props} me="u-n" data={data(entry())} labels={labels} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Nasi padang' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ubah' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Batalkan transaksi' })).toBeTruthy();
    expect(screen.queryByText(/Pindahkan ke ruang lain/)).toBeNull();
    expect(screen.getByText('kamu')).toBeTruthy();
    expect(screen.queryByText('Transaksi ini sudah dibatalkan.')).toBeNull();
  });

  it('dicatat orang lain: namanya', () => {
    render(<DetailReal {...props} me="u-f" data={data(entry())} labels={labels} />);
    expect(screen.getByText('Novanda')).toBeTruthy();
  });

  it('dibatalkan (S6-D3): banner + Pulihkan, nominal dicoret dengan teks dibatalkan, tanpa Ubah', () => {
    const { container } = render(
      <DetailReal
        {...props}
        me="u-n"
        data={data(entry({ voidedAt: '2026-11-02T09:00:00+07:00' }))}
        labels={labels}
      />,
    );
    expect(screen.getByText('Transaksi ini sudah dibatalkan.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pulihkan' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Batalkan transaksi' })).toBeNull();
    expect(container.querySelector('.line-through')).not.toBeNull();
    expect(screen.getByText('dibatalkan').className).toContain('sr-only');
  });

  it('dibatalkan lewat 90 hari: teks S6-S1 lewat, tanpa Pulihkan', () => {
    render(
      <DetailReal
        {...props}
        me="u-n"
        data={data(entry({ voidedAt: '2026-07-01T09:00:00+07:00' }), true)}
        labels={labels}
      />,
    );
    expect(
      screen.getByText('Lewat 90 hari, transaksi ini tidak bisa dipulihkan lagi.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pulihkan' })).toBeNull();
  });

  it('gagal muat: salinan tetap + Coba lagi + kembali ke Transaksi', () => {
    render(<DetailFailed listHref={props.listHref} />);
    expect(screen.getByText('Transaksi belum bisa dimuat.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Transaksi/ }).getAttribute('href')).toBe(
      '/pribadi/transaksi',
    );
  });
});
