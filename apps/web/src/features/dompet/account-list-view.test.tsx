import { cleanup, render, screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { afterEach, describe, expect, it } from 'vitest';
import type { AccountVM } from '@/features/ledger/types';
import { AccountListView } from './account-list-view';

afterEach(cleanup);

const acc = (over: Partial<AccountVM> & Pick<AccountVM, 'id' | 'name' | 'balance'>): AccountVM => ({
  pocket: 'operasional',
  walletType: 'bank',
  openedOn: '2026-11-01',
  archived: false,
  ...over,
});

const href = (id: string) => `/pribadi/dompet/${id}` as Route;
const add = (className: string) => (
  <button type="button" className={className}>
    Tambah dompet
  </button>
);

describe('AccountListView (Dompet nyata)', () => {
  it('saldo dan subtotal berasal dari VM apa adanya (bukan dihitung dari entri)', () => {
    render(
      <AccountListView
        ruang="pribadi"
        accounts={[
          acc({ id: 'a1', name: 'BCA', balance: 1_250_000 }),
          acc({ id: 'a2', name: 'Tunai', balance: 75_000, walletType: 'cash' }),
          acc({ id: 'a3', name: 'Deposito', balance: 4_000_000, pocket: 'tabungan' }),
          acc({ id: 'a4', name: 'Kas Kantor', balance: 900_000, pocket: 'kantor' }),
        ]}
        accountHref={href}
        renderAdd={add}
      />,
    );
    const ops = screen.getByRole('region', { name: 'Operasional' });
    expect(within(ops).getByRole('link', { name: /BCA/ })).toHaveTextContent('1.250.000');
    expect(within(ops).getByRole('link', { name: /Tunai/ })).toHaveTextContent('75.000');
    // Subtotal Operasional = 1.250.000 + 75.000.
    expect(ops).toHaveTextContent('1.325.000');
    // Kekayaan bersih = Operasional + Tabungan, tanpa Kantor.
    expect(screen.getByTestId('net-worth')).toHaveTextContent('5.325.000');
    expect(screen.getByTestId('net-worth')).not.toHaveTextContent('6.225.000');
    expect(
      within(screen.getByRole('region', { name: 'Kantor' })).getByText(
        'Tidak masuk hitungan pribadi',
      ),
    ).toBeTruthy();
  });

  it('tautan dompet memakai href dari pemanggil; Bersama tanpa catatan Kantor di kekayaan', () => {
    render(
      <AccountListView
        ruang="bersama"
        accounts={[acc({ id: 'k1', name: 'Kas Rumah', balance: 400_000 })]}
        accountHref={(id) => `/bersama/dompet/${id}` as Route}
        renderAdd={add}
      />,
    );
    expect(screen.getByRole('link', { name: /Kas Rumah/ })).toHaveAttribute(
      'href',
      '/bersama/dompet/k1',
    );
    expect(screen.getByText('Operasional + tabungan.')).toBeTruthy();
  });

  it('kosong: salinan tetap dengan ruang + Tambah dompet, tanpa kekayaan bersih', () => {
    render(<AccountListView ruang="bersama" accounts={[]} accountHref={href} renderAdd={add} />);
    expect(screen.getByText('Belum ada dompet di Bersama.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tambah dompet' })).toBeTruthy();
    expect(screen.queryByTestId('net-worth')).toBeNull();
  });

  it('tombol tambah di isi tersembunyi di laptop (tombol header yang dipakai)', () => {
    render(
      <AccountListView
        ruang="pribadi"
        accounts={[acc({ id: 'a1', name: 'BCA', balance: 1 })]}
        accountHref={href}
        renderAdd={add}
      />,
    );
    expect(screen.getByRole('button', { name: 'Tambah dompet' }).className).toContain(
      'laptop:hidden',
    );
  });
});
