import { formatRupiah } from '@dompetku/domain';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountVM, Pocket } from '@/features/ledger/types';
import { CatatSheet } from './catat-sheet';
import type { CatatPreset, CatatSource } from './source';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({ toast }));

afterEach(() => {
  cleanup();
  toast.mockClear();
});

const acc = (id: string, name: string, pocket: Pocket): AccountVM => ({
  id,
  name,
  pocket,
  walletType: 'bank',
  openedOn: '2026-11-01',
  archived: false,
  balance: 9_000_000,
});

function setup(preset: CatatPreset) {
  const save = vi.fn<CatatSource['save']>(() =>
    Promise.resolve({
      ok: true,
      entryId: 'e1',
      version: 1,
      replayed: false,
      toast: 'Tersimpan di Pribadi',
    }),
  );
  const source: CatatSource = {
    ruangLabel: { pribadi: 'Pribadi', bersama: 'Bersama' },
    options: () => ({
      accounts: [acc('t1', 'Stockbit', 'trading'), acc('b1', 'BCA', 'operasional')],
      categories: [],
    }),
    chips: () => [],
    spaceTransferTargets: () => [],
    save,
    undo: () => Promise.resolve(true),
  };
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <CatatSheet
        open={open}
        onOpenChange={setOpen}
        ruang="pribadi"
        source={source}
        today="2026-11-14"
        keypad="os"
        preset={preset}
      />
    );
  }
  render(<Host />);
  return { save };
}

describe('CatatSheet · setor/tarik modal (S12-TR4)', () => {
  it('Setor: judul statis dengan ruang, tanpa menu jenis dan tanpa Pindah ruang; transfer biasa disimpan; toast ruang + dompet', async () => {
    const user = userEvent.setup();
    const { save } = setup({
      kind: 'setor',
      account: { id: 't1', name: 'Stockbit' },
      capitalLeft: 0,
    });
    const dialog = await screen.findByRole('dialog', { name: /^Setor modal/ });
    expect(screen.queryByRole('button', { name: /Pengeluaran|Transfer · Pribadi/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Pindah ke Bersama/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Ruang lain/ })).toBeNull();
    expect(dialog).toHaveTextContent(
      'Setor modal bukan pengeluaran. Laporan dan anggaran tidak berubah.',
    );
    await user.type(screen.getByRole('textbox', { name: 'Nominal' }), '5000000');
    await user.click(screen.getByRole('button', { name: /^Simpan/ }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      type: 'transfer',
      accountId: 'b1',
      counterAccountId: 't1',
      amount: 5_000_000,
    });
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: `Modal disetor ke Stockbit · Pribadi · ${formatRupiah(5_000_000)} dari BCA`,
        }),
      );
    });
  });

  it('Tarik: pratinjau hasil ditarik hanya bila di atas sisa modal; toast arah tarik', async () => {
    const user = userEvent.setup();
    const { save } = setup({
      kind: 'tarik',
      account: { id: 't1', name: 'Stockbit' },
      capitalLeft: 1_000_000,
    });
    const dialog = await screen.findByRole('dialog', { name: /^Tarik modal/ });
    expect(dialog).toHaveTextContent('Tarik modal bukan pemasukan.');
    const amount = screen.getByRole('textbox', { name: 'Nominal' });
    await user.type(amount, '800000');
    expect(dialog).not.toHaveTextContent('di atas sisa modal');
    await user.clear(amount);
    await user.type(amount, '1500000');
    expect(dialog).toHaveTextContent(/500\.000 di atas sisa modal dicatat sebagai hasil ditarik\./);
    await user.click(screen.getByRole('button', { name: /^Simpan/ }));
    await waitFor(() => {
      expect(save).toHaveBeenCalled();
    });
    expect(save.mock.calls[0]?.[0]).toMatchObject({ accountId: 't1', counterAccountId: 'b1' });
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: `Modal ditarik dari Stockbit · Pribadi · ${formatRupiah(1_500_000)} ke BCA`,
        }),
      );
    });
  });
});
