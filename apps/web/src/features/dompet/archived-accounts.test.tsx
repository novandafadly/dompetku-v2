import { cleanup, render, screen } from '@testing-library/react';
import type { Route } from 'next';
import { afterEach, describe, expect, it } from 'vitest';
import type { AccountVM } from '@/features/ledger/types';
import { ArchivedAccounts } from './archived-accounts';

afterEach(cleanup);

const acc = (id: string, name: string): AccountVM => ({
  id,
  name,
  pocket: 'operasional',
  walletType: 'bank',
  openedOn: '2026-10-01',
  archived: true,
  balance: 0,
});

describe('ArchivedAccounts (S7-W3)', () => {
  it('kartu Diarsipkan: tautan ke riwayat, tanpa saldo besar dan tanpa aksi pulihkan', () => {
    render(
      <ArchivedAccounts
        accounts={[acc('a1', 'BCA lama'), acc('a2', 'Tunai')]}
        accountHref={(id) => `/pribadi/dompet/${id}` as Route}
      />,
    );
    const card = screen.getByRole('region', { name: 'Diarsipkan' });
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/pribadi/dompet/a1');
    expect(card).toHaveTextContent('BCA lama');
    expect(card.textContent).not.toMatch(/Rp/);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('kosong: tidak dirender', () => {
    const { container } = render(
      <ArchivedAccounts accounts={[]} accountHref={() => '/x' as Route} />,
    );
    expect(container.textContent).toBe('');
  });
});
