import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountVM, EntryVM } from '@/features/ledger/types';
import type { DompetRiwayat } from '@/server/ledger/dompet';
import { DompetFailed, DompetReal } from './dompet';
import { DompetDetailFailed, DompetDetailReal } from './dompet-detail';

afterEach(cleanup);

const host = vi.hoisted(() => vi.fn());
vi.mock('./dompet-islands', () => ({
  AddWalletHostIsland: (props: { children: ReactNode }) => {
    host({ ...props, children: undefined });
    return <div data-testid="host">{props.children}</div>;
  },
  AddWalletTriggerIsland: ({ className }: { className?: string }) => (
    <button type="button" className={className}>
      Tambah dompet
    </button>
  ),
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

const acc = (over: Partial<AccountVM> & Pick<AccountVM, 'id' | 'name' | 'balance'>): AccountVM => ({
  pocket: 'operasional',
  walletType: 'bank',
  openedOn: '2026-11-01',
  archived: false,
  ...over,
});

describe('DompetReal', () => {
  it('daftar dari VM; tautan dompet membawa query tema; host menerima nama dompet', () => {
    render(
      <DompetReal
        ruang="pribadi"
        query="?theme=light"
        accounts={[acc({ id: 'a1', name: 'BCA', balance: 1_250_000 })]}
      />,
    );
    expect(screen.getByRole('link', { name: /BCA/ })).toHaveAttribute(
      'href',
      '/pribadi/dompet/a1?theme=light',
    );
    expect(screen.getByTestId('net-worth')).toHaveTextContent('1.250.000');
    expect(host).toHaveBeenCalledWith({
      ruang: 'pribadi',
      existingNames: ['BCA'],
      children: undefined,
    });
    // Aksi S7 tidak dirender di mode nyata.
    expect(screen.queryByText(/Cocokkan saldo/)).toBeNull();
    expect(screen.queryByText(/Arsipkan/)).toBeNull();
  });

  it('kosong: Belum ada dompet di {Ruang}. + Tambah dompet (satu tombol)', () => {
    render(<DompetReal ruang="bersama" query="" accounts={[]} />);
    expect(screen.getByText('Belum ada dompet di Bersama.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Tambah dompet' }).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('net-worth')).toBeNull();
  });
});

describe('DompetFailed', () => {
  it('salinan tetap + Coba lagi, tanpa data', () => {
    render(<DompetFailed />);
    expect(screen.getByRole('alert')).toHaveTextContent('Dompet belum bisa dimuat.');
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
  });
});

const by = { id: 'u', name: 'Novanda', initial: 'N' };
const entry = (id: string, over: Partial<EntryVM>): EntryVM => ({
  id,
  version: 1,
  kind: 'expense',
  occurredOn: '2026-11-02',
  createdAt: '2026-11-02T08:00:00+07:00',
  createdBy: by,
  accountId: 'a1',
  accountName: 'BCA',
  amount: 25_000,
  categoryName: 'Makan Siang & Minum',
  ...over,
});

describe('DompetDetailReal', () => {
  const data: DompetRiwayat = {
    account: acc({ id: 'a1', name: 'BCA', balance: 475_000 }),
    entries: [
      entry('e-1', { description: 'Nasi padang' }),
      entry('e-2', {
        kind: 'transfer',
        amount: 500_000,
        counterAccountId: 'a2',
        counterAccountName: 'Tunai',
      }),
      entry('e-3', {
        kind: 'transfer',
        accountId: 'a2',
        accountName: 'Tunai',
        counterAccountId: 'a1',
        counterAccountName: 'BCA',
        amount: 100_000,
      }),
    ],
    opening: [
      entry('e-0', { kind: 'opening_balance', amount: 1_000_000, occurredOn: '2026-11-01' }),
    ],
    hasMore: true,
  };
  const props = {
    ruang: 'pribadi' as const,
    today: '2026-11-02',
    query: '',
    dompetHref: '/pribadi/dompet' as never,
    moreHref: '/pribadi/dompet/a1?tampil=100' as never,
    data,
  };

  it('saldo dari VM; efek per baris pada dompet ini; saldo awal terpisah di bawah; Muat lagi = tautan', () => {
    render(<DompetDetailReal {...props} />);
    expect(screen.getByTestId('wallet-balance')).toHaveTextContent('475.000');
    const today = screen.getByRole('list', { name: /Riwayat Hari ini/ });
    expect(screen.getByRole('link', { name: /Nasi padang/ })).toHaveTextContent('25.000');
    // Transfer keluar dari BCA mengurangi; transfer masuk ke BCA menambah.
    expect(screen.getByRole('link', { name: /BCA → Tunai/ })).toHaveTextContent('500.000');
    expect(today).toHaveTextContent('−');
    expect(screen.getByRole('link', { name: /Tunai → BCA/ })).toHaveTextContent('100.000');
    const opening = screen.getByRole('list', { name: 'Riwayat Entri pembuka' });
    expect(opening).toHaveTextContent('Saldo awal');
    expect(opening).toHaveTextContent('1.000.000');
    expect(screen.getByRole('link', { name: /Muat lagi/ })).toHaveAttribute(
      'href',
      '/pribadi/dompet/a1?tampil=100',
    );
    expect(screen.getByRole('link', { name: 'Dompet' })).toHaveAttribute('href', '/pribadi/dompet');
  });

  it('semua tampil: tanpa Muat lagi; kosong: salinan tetap', () => {
    render(
      <DompetDetailReal
        {...props}
        moreHref={null}
        data={{ ...data, entries: [], opening: [], hasMore: false }}
      />,
    );
    expect(screen.queryByRole('link', { name: /Muat lagi/ })).toBeNull();
    expect(screen.getByText('Belum ada transaksi di dompet ini.')).toBeTruthy();
  });
});

describe('DompetDetailFailed', () => {
  it('kembali ke Dompet + salinan gagal muat + Coba lagi', () => {
    render(<DompetDetailFailed dompetHref={'/pribadi/dompet' as never} />);
    expect(screen.getByRole('link', { name: 'Dompet' })).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('Riwayat dompet belum bisa dimuat.');
  });
});
