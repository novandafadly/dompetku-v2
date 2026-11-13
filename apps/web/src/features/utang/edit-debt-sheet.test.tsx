import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditDebtSheet, type EditResult, type EditSubmit } from './edit-debt-sheet';
import type { ContactVM } from './types';

afterEach(cleanup);

const contact = (id: string, name: string): ContactVM => ({
  contactId: id,
  name,
  borrowedRemaining: 0,
  lentRemaining: 0,
  borrowedCount: 0,
  lentCount: 0,
});
const DETAIL = {
  debtId: 'd1',
  contactId: 'c1',
  contactName: 'Budi',
  contactArchived: false,
  title: 'Cicilan motor',
  note: null,
  direction: 'borrowed' as const,
};

function setup(result: EditResult = { ok: true }) {
  const onSave = vi.fn<(i: EditSubmit) => Promise<EditResult>>(() => Promise.resolve(result));
  const onSaved = vi.fn();
  render(
    <EditDebtSheet
      open
      onOpenChange={vi.fn()}
      detail={DETAIL}
      contacts={[contact('c1', 'Budi'), contact('c2', 'Citra')]}
      onSave={onSave}
      onSaved={onSaved}
    />,
  );
  return { onSave, onSaved };
}

describe('EditDebtSheet (S11-DT2)', () => {
  it('kalimat di atas, kolom terisi, tanpa kolom nominal, kotak statis terkunci', async () => {
    setup();
    expect(await screen.findByRole('dialog', { name: /^Ubah utang\s*Pribadi$/ })).toBeTruthy();
    expect(
      screen.getByText('Perubahan ini tidak mengubah saldo, pembayaran, atau sisa.'),
    ).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Kontak' })).toHaveValue('c1');
    expect(screen.getByRole('textbox', { name: /Untuk apa/ })).toHaveValue('Cicilan motor');
    expect(screen.queryByRole('textbox', { name: /Jumlah|Sisa/ })).toBeNull();
    expect(screen.getByText(/Jumlah dan pembayaran tidak bisa diubah/)).toBeTruthy();
  });

  it('simpan: kontak baru dipilih lewat nama, judul kosong = null, onSaved membawa nama', async () => {
    const user = userEvent.setup();
    const { onSave, onSaved } = setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kontak' }), 'c2');
    await user.clear(screen.getByRole('textbox', { name: /Untuk apa/ }));
    await user.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('Citra');
    });
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      debtId: 'd1',
      contactId: 'c2',
      title: null,
      note: null,
    });
  });

  it('contact_name_taken (kontak baru): galat di kolom nama', async () => {
    const user = userEvent.setup();
    setup({ ok: false, code: 'contact_name_taken' });
    await user.click(screen.getByRole('button', { name: 'Tambah kontak baru' }));
    await user.type(screen.getByRole('textbox', { name: 'Nama kontak' }), 'Budi');
    await user.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    expect(
      await screen.findByText('Sudah ada kontak dengan nama ini. Pilih dari daftar.'),
    ).toBeTruthy();
  });
});
