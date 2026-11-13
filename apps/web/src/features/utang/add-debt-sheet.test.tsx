import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountVM } from '@/features/ledger/types';
import {
  AddDebtSheet,
  type AddDebtSheetProps,
  type CreateDebtSubmit,
  type CreateResult,
} from './add-debt-sheet';
import type { ContactVM } from './types';

afterEach(cleanup);

const acc = (over: Partial<AccountVM> & Pick<AccountVM, 'id' | 'name'>): AccountVM => ({
  pocket: 'operasional',
  walletType: 'bank',
  openedOn: '2026-01-01',
  archived: false,
  balance: 1_000_000,
  ...over,
});
const ACCOUNTS = [
  acc({ id: 'a-bca', name: 'BCA' }),
  acc({ id: 'a-kas', name: 'Kas Kantor', pocket: 'kantor' }),
];
const CONTACTS: ContactVM[] = [
  {
    contactId: 'c1',
    name: 'Budi',
    borrowedRemaining: 0,
    lentRemaining: 0,
    borrowedCount: 0,
    lentCount: 0,
  },
  {
    contactId: 'c2',
    name: 'Citra',
    borrowedRemaining: 0,
    lentRemaining: 0,
    borrowedCount: 0,
    lentCount: 0,
  },
];

function setup(
  over: Partial<AddDebtSheetProps> = {},
  result: CreateResult = { ok: true, debtId: 'd1' },
) {
  const onCreate = vi.fn<(i: CreateDebtSubmit) => Promise<CreateResult>>(() =>
    Promise.resolve(result),
  );
  const onCreated = vi.fn();
  render(
    <AddDebtSheet
      open
      onOpenChange={vi.fn()}
      accounts={ACCOUNTS}
      contacts={CONTACTS}
      today="2026-11-13"
      onCreate={onCreate}
      onCreated={onCreated}
      {...over}
    />,
  );
  return { onCreate, onCreated };
}

const save = () => screen.getByRole('button', { name: /^(Simpan utang|Tetap simpan)$/ });

describe('AddDebtSheet (S11-AD1)', () => {
  it('judul menyebut ruang; Arah tanpa pilihan awal dan jadi fokus awal; cara mencatat bawaan Baru', async () => {
    setup();
    expect(await screen.findByRole('dialog', { name: /^Tambah utang\s*Pribadi$/ })).toBeTruthy();
    const arah = screen.getByRole('radiogroup', { name: 'Arah' });
    expect(
      within(arah)
        .getAllByRole('radio')
        .every((r) => r.getAttribute('aria-checked') === 'false'),
    ).toBe(true);
    expect(within(arah).getAllByRole('radio')[0]).toHaveFocus();
    expect(
      within(screen.getByRole('radiogroup', { name: 'Cara mencatat' })).getByRole('radio', {
        name: 'Baru',
      }),
    ).toBeChecked();
    expect(screen.getByText('Uangnya masuk atau keluar dari dompet yang kamu pilih.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Jumlah pinjaman' })).toBeTruthy();
  });

  it('kalimat bantu dan label dompet mengikuti arah', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('radio', { name: 'Saya berutang' }));
    expect(screen.getByText('Kamu meminjam uang dari orang lain.')).toBeTruthy();
    expect(screen.getByText('Uangnya masuk ke dompet yang kamu pilih.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Uang masuk ke' })).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Piutang' }));
    expect(screen.getByText('Kamu meminjamkan uang ke orang lain.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Uang keluar dari' })).toBeTruthy();
  });

  it('Sudah berjalan: label Sisa saat ini, tanpa dompet dan tanpa pratinjau, label tanggal Utang mulai', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Cara mencatat' })).getByRole('radio', {
        name: 'Sudah berjalan',
      }),
    );
    expect(
      screen.getByText('Hanya mencatat sisa saat ini. Saldo dompet dan Laporan tidak berubah.'),
    ).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Sisa saat ini' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /Uang|Dompet/ })).toBeNull();
    expect(screen.getByLabelText('Utang mulai')).toBeTruthy();
  });

  it('isian kurang tetap diterima: galat kolom, fokus ke kolom pertama yang salah, tidak mengirim', async () => {
    const user = userEvent.setup();
    const { onCreate } = setup();
    await user.click(save());
    expect(screen.getByText('Pilih arah utang.')).toBeTruthy();
    expect(
      within(screen.getByRole('radiogroup', { name: 'Arah' })).getAllByRole('radio')[0],
    ).toHaveFocus();
    expect(onCreate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: 'Saya berutang' }));
    await user.click(save());
    expect(screen.getByText('Pilih kontak atau tambah kontak baru.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Kontak' })).toHaveFocus();
  });

  it('Tambah kontak baru menukar pilihan dengan kolom nama dan sebaliknya', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Tambah kontak baru' }));
    expect(screen.queryByRole('combobox', { name: 'Kontak' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Nama kontak' }), 'Dewi');
    await user.click(screen.getByRole('button', { name: 'Pilih dari daftar' }));
    expect(screen.getByRole('combobox', { name: 'Kontak' })).toBeTruthy();
  });

  it('tanpa kontak aktif: langsung kolom Nama kontak, tanpa penukar', () => {
    setup({ contacts: [] });
    expect(screen.getByRole('textbox', { name: 'Nama kontak' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pilih dari daftar' })).toBeNull();
  });

  it('Baru + kontak baru: mengirim contactName, dompet, jumlah, tanggal; onCreated membawa info toast', async () => {
    const user = userEvent.setup();
    const { onCreate, onCreated } = setup();
    await user.click(screen.getByRole('radio', { name: 'Saya berutang' }));
    await user.click(screen.getByRole('button', { name: 'Tambah kontak baru' }));
    await user.type(screen.getByRole('textbox', { name: 'Nama kontak' }), 'Dewi');
    await user.type(screen.getByRole('textbox', { name: 'Jumlah pinjaman' }), '2000000');
    await user.click(save());
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      direction: 'borrowed',
      mode: 'baru',
      principal: 2_000_000,
      contactName: 'Dewi',
      accountId: 'a-bca',
      openedOn: '2026-11-13',
      allowNegative: false,
    });
    expect(onCreate.mock.calls[0]?.[0]).not.toHaveProperty('contactId');
    expect(onCreated.mock.calls[0]?.[0]).toMatchObject({
      name: 'Dewi',
      amount: 2_000_000,
      accountName: 'BCA',
    });
  });

  it('Sudah berjalan: tidak mengirim accountId', async () => {
    const user = userEvent.setup();
    const { onCreate } = setup();
    await user.click(screen.getByRole('radio', { name: 'Piutang' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kontak' }), 'c2');
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Cara mencatat' })).getByRole('radio', {
        name: 'Sudah berjalan',
      }),
    );
    await user.type(screen.getByRole('textbox', { name: 'Sisa saat ini' }), '500000');
    await user.click(save());
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalled();
    });
    const sent = onCreate.mock.calls[0]?.[0];
    expect(sent).toMatchObject({ mode: 'berjalan', contactId: 'c2', direction: 'lent' });
    expect(sent).not.toHaveProperty('accountId');
  });

  it('pratinjau KolomKas: piutang membuat saldo keluar; saldo negatif = peringatan + Tetap simpan', async () => {
    const user = userEvent.setup();
    const { onCreate } = setup();
    await user.click(screen.getByRole('radio', { name: 'Piutang' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kontak' }), 'c1');
    await user.type(screen.getByRole('textbox', { name: 'Jumlah pinjaman' }), '1500000');
    expect(screen.getByRole('table', { name: /sesudah dicatat/ })).toHaveTextContent(
      /Jumlah pinjaman−Rp\s1\.500\.000/,
    );
    expect(
      screen.getByText(
        /Saldo BCA tinggal Rp\s1\.000\.000\. Kalau disimpan, saldonya jadi −Rp\s500\.000\./,
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Tetap simpan' }));
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({ allowNegative: true });
  });

  it('galat kontak sama: di kolom nama; galat jaringan: kotak atas dengan Coba lagi (clientId sama)', async () => {
    const user = userEvent.setup();
    const onCreate = vi
      .fn<(i: CreateDebtSubmit) => Promise<CreateResult>>()
      .mockResolvedValueOnce({ ok: false, code: 'network' })
      .mockResolvedValueOnce({ ok: true, debtId: 'd' });
    const { onCreated } = setup({ onCreate });
    await user.click(screen.getByRole('radio', { name: 'Saya berutang' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kontak' }), 'c1');
    await user.type(screen.getByRole('textbox', { name: 'Jumlah pinjaman' }), '100000');
    await user.click(save());
    expect(await screen.findByText(/Koneksi terputus saat mengirim/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    expect(onCreate.mock.calls[0]?.[0].clientId).toBe(onCreate.mock.calls[1]?.[0].clientId);
  });

  it('contact_name_taken: galat di kolom nama', async () => {
    const user = userEvent.setup();
    setup({ contacts: [] }, { ok: false, code: 'contact_name_taken' });
    await user.click(screen.getByRole('radio', { name: 'Piutang' }));
    await user.type(screen.getByRole('textbox', { name: 'Nama kontak' }), 'Budi');
    await user.type(screen.getByRole('textbox', { name: 'Jumlah pinjaman' }), '100000');
    await user.click(save());
    expect(
      await screen.findByText('Sudah ada kontak dengan nama ini. Pilih dari daftar.'),
    ).toBeTruthy();
  });

  it('tanpa dompet di mode Baru: NoAccount; Sudah berjalan tetap bisa', async () => {
    const user = userEvent.setup();
    setup({ accounts: [] });
    expect(
      screen.getByText(
        'Belum ada dompet di Pribadi. Tambah dompet dulu, atau pilih Sudah berjalan.',
      ),
    ).toBeTruthy();
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Cara mencatat' })).getByRole('radio', {
        name: 'Sudah berjalan',
      }),
    );
    expect(screen.queryByText(/Belum ada dompet/)).toBeNull();
  });
});
