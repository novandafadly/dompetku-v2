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

const acc = (id: string, name: string, pocket: Pocket, balance = 9_000_000): AccountVM => ({
  id,
  name,
  pocket,
  walletType: 'bank',
  openedOn: '2026-11-01',
  archived: false,
  balance,
  ...(pocket === 'aset' ? { assetKind: 'emas' as const } : {}),
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
      accounts: [acc('a1', 'Emas Antam', 'aset', 500_000), acc('b1', 'BCA', 'operasional')],
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
        today="2026-11-16"
        keypad="os"
        preset={preset}
      />
    );
  }
  render(<Host />);
  return { save };
}

describe('CatatSheet · isi/cairkan aset (S14-AS5)', () => {
  it('Isi: judul dengan nama aset dan ruang; catatan bukan pengeluaran; transfer biasa; toast sebut aset', async () => {
    const user = userEvent.setup();
    const { save } = setup({
      kind: 'isi',
      account: { id: 'a1', name: 'Emas Antam' },
      capitalLeft: 0,
    });
    const dialog = await screen.findByRole('dialog', { name: /^Isi Emas Antam/ });
    expect(screen.queryByRole('button', { name: /Ruang lain/ })).toBeNull();
    expect(dialog).toHaveTextContent('Bukan pengeluaran. Laporan dan anggaran tidak berubah.');
    await user.type(screen.getByRole('textbox', { name: 'Nominal' }), '700000');
    await user.click(screen.getByRole('button', { name: /^Simpan/ }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      type: 'transfer',
      accountId: 'b1',
      counterAccountId: 'a1',
      amount: 700_000,
    });
    expect(toast.mock.calls[0]?.[0].message).toMatch(
      /Emas Antam diisi · Pribadi · Rp.*700\.000 dari BCA/,
    );
  });

  it('Cairkan: nominal di atas nilai aset = peringatan aset tidak bisa minus, Simpan tidak mengirim', async () => {
    const user = userEvent.setup();
    const { save } = setup({
      kind: 'cairkan',
      account: { id: 'a1', name: 'Emas Antam' },
      capitalLeft: 0,
    });
    const dialog = await screen.findByRole('dialog', { name: /^Cairkan Emas Antam/ });
    expect(dialog).toHaveTextContent('Bukan pemasukan.');
    await user.type(screen.getByRole('textbox', { name: 'Nominal' }), '600000');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nilai Emas Antam tidak cukup. Aset tidak bisa minus.',
    );
    await user.click(screen.getByRole('button', { name: /^Simpan/ }));
    expect(save).not.toHaveBeenCalled();
  });

  it('galat server asset_negative (balapan): pesan tanpa nominal, tanpa tombol Tetap simpan', async () => {
    const user = userEvent.setup();
    const { save } = setup({
      kind: 'cairkan',
      account: { id: 'a1', name: 'Emas Antam' },
      capitalLeft: 0,
    });
    save.mockResolvedValueOnce({ ok: false, code: 'asset_negative' });
    await screen.findByRole('dialog');
    await user.type(screen.getByRole('textbox', { name: 'Nominal' }), '400000');
    await user.click(screen.getByRole('button', { name: /^Simpan/ }));
    expect(await screen.findByText('Nilai aset tidak cukup. Aset tidak bisa minus.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tetap simpan' })).toBeNull();
  });
});
