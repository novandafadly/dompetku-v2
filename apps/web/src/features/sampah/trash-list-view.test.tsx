import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EntryVM, TrashVM } from '@/features/ledger/types';
import { TrashListView } from './trash-list-view';

function item(id: string, over: Partial<EntryVM> = {}): TrashVM {
  return {
    entry: {
      id,
      version: 1,
      kind: 'expense',
      occurredOn: '2026-11-01',
      createdAt: '2026-11-01T08:00:00+07:00',
      createdBy: { id: 'u', name: 'Novanda', initial: 'N' },
      accountId: 'a',
      accountName: 'BCA',
      amount: 12_345_678_900,
      categoryName: 'Makan',
      description: 'Nasi padang',
      voidedAt: '2026-10-25T09:00:00+07:00',
      ...over,
    },
    purgeAfter: '2027-01-23T09:00:00+07:00',
  };
}

describe('TrashListView', () => {
  it('baris bukan tautan; tombol pulihkan dari slot menerima label pembaca layar', () => {
    const restore = vi.fn((_: TrashVM, slot: { labelSuffix: string }) => (
      <button type="button">{`Pulihkan ${slot.labelSuffix}`}</button>
    ));
    render(
      <TrashListView
        today="2026-11-02"
        items={[item('e1'), item('e2', { kind: 'transfer', counterAccountName: 'Tunai' })]}
        restore={restore}
      />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Dibatalkan Min, 25 Okt');
    expect(rows[0]).toHaveTextContent('Terhapus permanen Sab, 23 Jan 2027');
    expect(rows[1]).toHaveTextContent('Pindah dompet · BCA → Tunai');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(
      within(rows[0] ?? document.body).getByRole('button', { name: /^Pulihkan Nasi padang Rp/ }),
    ).toBeTruthy();
  });

  it('kosong: salinan S6-S1 tanpa tombol', () => {
    render(<TrashListView today="2026-11-02" items={[]} restore={() => <button>x</button>} />);
    expect(
      screen.getByText(
        'Sampah kosong. Transaksi yang dibatalkan bisa dipulihkan di sini selama 90 hari.',
      ),
    ).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('cicilan utang yang dibatalkan sendiri (S11): nama kontak dan jenis searah, bukan Tanpa kategori', () => {
    render(
      <TrashListView
        today="2026-11-02"
        items={[
          item('c1', {
            kind: 'debt_payment',
            direction: 'out',
            debt: { id: 'u1', direction: 'borrowed', contactName: 'Budi' },
          }),
          item('c2', {
            kind: 'debt_payment',
            direction: 'in',
            debt: { id: 'u2', direction: 'lent', contactName: 'Sari' },
          }),
        ]}
        restore={(_, slot) => <button type="button">{`Pulihkan ${slot.labelSuffix}`}</button>}
      />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Budi');
    expect(rows[0]).toHaveTextContent('Pembayaran utang · BCA');
    expect(rows[1]).toHaveTextContent('Sari');
    expect(rows[1]).toHaveTextContent('Penerimaan piutang · BCA');
    expect(screen.queryByText(/Tanpa kategori/)).toBeNull();
  });
});
