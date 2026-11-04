import { render, screen } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it, vi } from 'vitest';
import type { AccountVM, EntryVM, TrashVM } from '@/features/ledger/types';
import { SampahFailed, SampahReal } from './sampah';

const island = vi.hoisted(() => vi.fn());
vi.mock('./sampah-islands', () => ({
  TrashListIsland: (props: unknown) => {
    island(props);
    return <p>daftar</p>;
  },
}));
vi.mock('./transaksi-islands', () => ({
  RetryIsland: () => <button type="button">Coba lagi</button>,
}));

const backHref = '/pribadi/transaksi' as Route;
const entry: EntryVM = {
  id: 'e1',
  version: 2,
  kind: 'expense',
  occurredOn: '2026-11-01',
  createdAt: '2026-11-01T08:00:00+07:00',
  createdBy: { id: 'u', name: 'Novanda', initial: 'N' },
  accountId: 'a1',
  accountName: 'BCA',
  amount: 25_000,
  voidedAt: '2026-11-02T09:00:00+07:00',
};
const items: TrashVM[] = [{ entry, purgeAfter: '2027-01-31T09:00:00+07:00' }];
const accounts: AccountVM[] = [];

describe('SampahReal', () => {
  it('header (kembali ke Transaksi, H1 dengan ruang) dan pulau daftar menerima data ruang ini', () => {
    render(
      <SampahReal
        ruang="bersama"
        today="2026-11-02"
        backHref={backHref}
        data={{ items, accounts }}
        me="u"
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sampah · Bersama');
    expect(screen.getByRole('link', { name: 'Transaksi' })).toHaveAttribute('href', backHref);
    expect(island).toHaveBeenCalledWith({
      ruang: 'bersama',
      today: '2026-11-02',
      items,
      accounts,
    });
  });
});

describe('SampahReal: Pulihkan kaki antar ruang (R25)', () => {
  const leg = (id: string, by: string): TrashVM => ({
    entry: {
      ...entry,
      id,
      kind: 'space_transfer',
      direction: 'in',
      createdBy: { id: by, name: by === 'u' ? 'Novanda' : 'Farida', initial: 'F' },
    },
    purgeAfter: '2027-01-31T09:00:00+07:00',
  });

  it('kaki antar ruang milik anggota lain dikunci; milik sendiri dan entri biasa tidak', () => {
    const all = [
      leg('s-f', 'f'),
      leg('s-u', 'u'),
      {
        entry: { ...entry, createdBy: { id: 'f', name: 'Farida', initial: 'F' } },
        purgeAfter: '2027-01-31T09:00:00+07:00',
      },
    ];
    render(
      <SampahReal
        ruang="bersama"
        today="2026-11-02"
        backHref={backHref}
        data={{ items: all, accounts }}
        me="u"
      />,
    );
    const props = island.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(props.restoreLockedIds).toEqual(['s-f']);
    // Id user sesi tidak ikut ke pulau klien.
    expect(JSON.stringify(props)).not.toContain('"me"');
  });
});

describe('SampahFailed', () => {
  it('salinan tetap S6-S1 + Coba lagi, tanpa data', () => {
    render(<SampahFailed ruang="pribadi" backHref={backHref} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Sampah belum bisa dimuat.');
    expect(alert).toHaveTextContent('Periksa koneksi lalu coba lagi.');
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sampah · Pribadi');
  });
});
