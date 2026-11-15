import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountVM, CategoryVM, Pocket } from '@/features/ledger/types';
import { CatatSheet } from './catat-sheet';
import type { CatatOptions, CatatSource } from './source';

/**
 * Toggle `Dibayar dari dompet pribadi` (S12-CT1) dan sheet `Pembagian · Bersama` (CT2): hanya
 * Bersama dengan dua anggota (`options.split`), pengeluaran; dompet Pribadi pembayar dimuat malas
 * dari `options('pribadi')` tanpa Kantor/Trading.
 */

const TODAY = '2026-11-14';
const acc = (id: string, name: string, pocket: Pocket, balance = 1_000_000): AccountVM => ({
  id,
  name,
  pocket,
  walletType: 'bank',
  openedOn: '2026-11-01',
  archived: false,
  balance,
});
const CAT: CategoryVM = {
  id: 'listrik',
  parentId: null,
  name: 'Listrik',
  type: 'expense',
  icon: 'Lightning',
  archived: false,
};
const SPLIT = {
  me: { id: 'n', name: 'Novanda', initial: 'N' },
  partner: { id: 'f', name: 'Farida', initial: 'F' },
};
const BERSAMA: CatatOptions = {
  accounts: [acc('kas', 'Kas Rumah', 'operasional')],
  categories: [CAT],
  split: SPLIT,
};
const PRIBADI: CatatOptions = {
  accounts: [
    acc('kantor', 'Kas Kantor', 'kantor'),
    acc('stockbit', 'Stockbit', 'trading'),
    acc('bca', 'BCA', 'operasional'),
    acc('tabungan', 'Tabungan', 'tabungan'),
  ],
  categories: [CAT],
};

function setup(over: { bersama?: CatatOptions; ruang?: 'pribadi' | 'bersama' } = {}) {
  const save = vi.fn(() => Promise.resolve({ ok: false as const, code: 'unknown' as const }));
  const source: CatatSource = {
    ruangLabel: { pribadi: 'Pribadi', bersama: 'Bersama' },
    options: (r) => (r === 'bersama' ? (over.bersama ?? BERSAMA) : PRIBADI),
    chips: () => [CAT],
    spaceTransferTargets: () => [],
    save,
    undo: () => Promise.resolve(false),
  };
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <CatatSheet
        open={open}
        onOpenChange={setOpen}
        ruang={over.ruang ?? 'bersama'}
        source={source}
        today={TODAY}
        keypad="os"
        hourWIB={12}
      />
    );
  }
  render(<Host />);
  return { save };
}

afterEach(cleanup);

describe('CatatSheet · bagi tagihan Bersama (S12-CT1, CT2)', () => {
  it('sakelar hanya di pengeluaran Bersama dua anggota', async () => {
    const user = userEvent.setup();
    setup();
    expect(await screen.findByRole('switch', { name: 'Dibayar dari dompet pribadi' })).toBeTruthy();
    // Pemasukan: tidak ada.
    await user.click(screen.getByRole('button', { name: 'Pengeluaran · Bersama' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Pemasukan' }));
    expect(screen.queryByRole('switch', { name: 'Dibayar dari dompet pribadi' })).toBeNull();
  });

  it('Pribadi dan Bersama tanpa konteks patungan (solo/prototipe): tidak ada sakelar', async () => {
    setup({ ruang: 'pribadi' });
    await screen.findByRole('switch', { name: 'Talangan kantor' });
    expect(screen.queryByRole('switch', { name: 'Dibayar dari dompet pribadi' })).toBeNull();
    cleanup();
    setup({ bersama: { accounts: BERSAMA.accounts, categories: [CAT] } });
    await screen.findByRole('textbox', { name: 'Nominal' });
    expect(screen.queryByRole('switch', { name: 'Dibayar dari dompet pribadi' })).toBeNull();
  });

  it('menyala: dompet Pribadi tanpa Kantor/Trading, petunjuk sama rata, Ubah pembagian', async () => {
    const user = userEvent.setup();
    setup();
    const toggle = await screen.findByRole('switch', { name: 'Dibayar dari dompet pribadi' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    const select = await screen.findByRole('combobox', { name: 'Dari dompet pribadi' });
    await waitFor(() => {
      expect((select as HTMLSelectElement).value).toBe('bca');
    });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['BCA', 'Tabungan']);
    expect(screen.getByText('Dibagi rata dengan Farida')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ubah pembagian' })).toBeTruthy();
    // Mati lagi: dompet Bersama kembali.
    await user.click(toggle);
    expect(await screen.findByRole('combobox', { name: 'Dari dompet' })).toBeTruthy();
    expect(screen.queryByText('Dibagi rata dengan Farida')).toBeNull();
  });

  it('Pembagian: atur nominal bagian Farida → petunjuk dan draf simpan memuat split', async () => {
    const user = userEvent.setup();
    const { save } = setup();
    await user.type(await screen.findByRole('textbox', { name: 'Nominal' }), '400000');
    await user.click(screen.getByRole('radio', { name: 'Listrik' }));
    await user.click(screen.getByRole('switch', { name: 'Dibayar dari dompet pribadi' }));
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLSelectElement>('combobox', { name: 'Dari dompet pribadi' }).value,
      ).toBe('bca');
    });
    await user.click(screen.getByRole('button', { name: 'Ubah pembagian' }));
    expect(await screen.findByRole('heading', { name: 'Pembagian · Bersama' })).toBeTruthy();
    expect(await screen.findByText(/Masing-masing Rp\s200\.000\./)).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Atur nominal' }));
    const share = screen.getByRole('textbox', { name: 'Bagian Farida' });
    await user.clear(share);
    await user.type(share, '150000');
    expect(screen.getByText(/Bagian kamu Rp\s250\.000/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Pakai pembagian ini' }));
    expect(await screen.findByText(/Farida menanggung Rp\s150\.000/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    const draft = save.mock.calls[0] as unknown as [
      { split?: { accountId: string; partnerShare?: number }; ruang: string },
    ];
    expect(draft[0].split).toEqual({ accountId: 'bca', partnerShare: 150_000 });
    expect(draft[0].ruang).toBe('bersama');
  });

  it('nominal diturunkan di bawah bagian Farida → bagian dibuang, kembali sama rata', async () => {
    const user = userEvent.setup();
    const { save } = setup();
    const amount = await screen.findByRole('textbox', { name: 'Nominal' });
    await user.type(amount, '400000');
    await user.click(screen.getByRole('radio', { name: 'Listrik' }));
    await user.click(screen.getByRole('switch', { name: 'Dibayar dari dompet pribadi' }));
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLSelectElement>('combobox', { name: 'Dari dompet pribadi' }).value,
      ).toBe('bca');
    });
    await user.click(screen.getByRole('button', { name: 'Ubah pembagian' }));
    await user.click(await screen.findByRole('radio', { name: 'Atur nominal' }));
    const share = screen.getByRole('textbox', { name: 'Bagian Farida' });
    await user.clear(share);
    await user.type(share, '300000');
    await user.click(screen.getByRole('button', { name: 'Pakai pembagian ini' }));
    expect(await screen.findByText(/Farida menanggung Rp\s300\.000/)).toBeTruthy();
    const again = await screen.findByRole('textbox', { name: 'Nominal' });
    await user.clear(again);
    await user.type(again, '100000');
    expect(await screen.findByText('Dibagi rata dengan Farida')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    const draft = save.mock.calls[0] as unknown as [{ split?: { partnerShare?: number } }];
    expect(draft[0].split?.partnerShare).toBeUndefined();
  });

  it('Pembagian: bagian lebih dari total ditolak dengan salinan bingkai', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(await screen.findByRole('textbox', { name: 'Nominal' }), '100000');
    await user.click(screen.getByRole('switch', { name: 'Dibayar dari dompet pribadi' }));
    await user.click(await screen.findByRole('button', { name: 'Ubah pembagian' }));
    await user.click(await screen.findByRole('radio', { name: 'Atur nominal' }));
    const share = screen.getByRole('textbox', { name: 'Bagian Farida' });
    await user.clear(share);
    await user.type(share, '150000');
    expect(screen.getByText('Bagian Farida tidak boleh lebih dari total.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Pakai pembagian ini' }));
    expect(screen.getByRole('heading', { name: 'Pembagian · Bersama' })).toBeTruthy();
  });

  it('tanpa dompet di Pribadi: baris petunjuk dan Simpan tidak bisa', async () => {
    const user = userEvent.setup();
    const { save } = setup();
    // Ganti dompet Pribadi dengan daftar kosong lewat sumber baru.
    cleanup();
    const empty: CatatSource = {
      ruangLabel: { pribadi: 'Pribadi', bersama: 'Bersama' },
      options: (r) => (r === 'bersama' ? BERSAMA : { accounts: [], categories: [] }),
      chips: () => [CAT],
      spaceTransferTargets: () => [],
      save,
      undo: () => Promise.resolve(false),
    };
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <CatatSheet
          open={open}
          onOpenChange={setOpen}
          ruang="bersama"
          source={empty}
          today={TODAY}
          keypad="os"
          hourWIB={12}
        />
      );
    }
    render(<Host />);
    await user.type(await screen.findByRole('textbox', { name: 'Nominal' }), '50000');
    await user.click(screen.getByRole('radio', { name: 'Listrik' }));
    await user.click(screen.getByRole('switch', { name: 'Dibayar dari dompet pribadi' }));
    expect(
      await screen.findByText('Belum ada dompet di Pribadi. Tambah dompet di Pribadi dulu.'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(save).not.toHaveBeenCalled();
  });
});
