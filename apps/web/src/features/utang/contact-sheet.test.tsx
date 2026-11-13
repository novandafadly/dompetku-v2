import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ArchiveContactDialog,
  ContactSheet,
  type ContactMode,
  type ContactResult,
  type ContactSubmit,
} from './contact-sheet';

afterEach(cleanup);

const EDIT: ContactMode = {
  kind: 'edit',
  contact: {
    contactId: 'c1',
    name: 'Budi',
    borrowedRemaining: 1_500_000,
    lentRemaining: 0,
    borrowedCount: 2,
    lentCount: 1,
  },
};

function setup(mode: ContactMode, result: ContactResult = { ok: true }) {
  const onSubmit = vi.fn<(i: ContactSubmit) => Promise<ContactResult>>(() =>
    Promise.resolve(result),
  );
  const onArchive = vi.fn();
  render(
    <ContactSheet
      open
      onOpenChange={vi.fn()}
      mode={mode}
      onSubmit={onSubmit}
      onArchive={onArchive}
    />,
  );
  return { onSubmit, onArchive };
}

describe('ContactSheet (S11-KT2)', () => {
  it('Tambah: judul menyebut ruang, fokus di Nama, tanpa Arsipkan kontak', async () => {
    setup({ kind: 'add' });
    expect(await screen.findByRole('dialog', { name: /^Tambah kontak\s*Pribadi$/ })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Nama' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Arsipkan kontak' })).toBeNull();
  });

  it('Ubah: nama terisi, kalimat berlaku di semua utang, ringkasan jumlah (bukan uang), Arsipkan kontak', async () => {
    const user = userEvent.setup();
    const { onArchive } = setup(EDIT);
    expect(await screen.findByRole('dialog', { name: /^Ubah kontak\s*Pribadi$/ })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Nama' })).toHaveValue('Budi');
    expect(screen.getByText('Nama baru berlaku di semua utang kontak ini.')).toBeTruthy();
    expect(screen.getByText('Utang aktif 2 · Piutang aktif 1')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Arsipkan kontak' }));
    expect(onArchive).toHaveBeenCalled();
  });

  it('nama kosong atau 61 huruf: galat kolom, fokus, tidak mengirim', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ kind: 'add' });
    await user.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(screen.getByText('Nama kontak diisi 1 sampai 60 huruf.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Nama' })).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('simpan mengirim nama yang dipangkas; clientId sama untuk Coba lagi', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(i: ContactSubmit) => Promise<ContactResult>>()
      .mockResolvedValueOnce({ ok: false, code: 'network' })
      .mockResolvedValueOnce({ ok: true });
    render(
      <ContactSheet
        open
        onOpenChange={vi.fn()}
        mode={{ kind: 'add' }}
        onSubmit={onSubmit}
        onArchive={vi.fn()}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Nama' }), '  Dewi  ');
    await user.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText(/Sambungan ke server terputus/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(2);
    });
    expect(onSubmit.mock.calls[0]?.[0].name).toBe('Dewi');
    expect(onSubmit.mock.calls[0]?.[0].clientId).toBe(onSubmit.mock.calls[1]?.[0].clientId);
  });

  it('contact_name_taken: galat di kolom nama', async () => {
    const user = userEvent.setup();
    setup({ kind: 'add' }, { ok: false, code: 'contact_name_taken' });
    await user.type(screen.getByRole('textbox', { name: 'Nama' }), 'Budi');
    await user.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Sudah ada kontak dengan nama ini.')).toBeTruthy();
  });
});

describe('ArchiveContactDialog', () => {
  it('menyebut akibat; fokus awal di Kembali', async () => {
    const onConfirm = vi.fn();
    render(
      <ArchiveContactDialog
        open
        onOpenChange={vi.fn()}
        name="Budi"
        busy={false}
        failure={null}
        onConfirm={onConfirm}
      />,
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Arsipkan Budi?' });
    expect(dialog).toHaveTextContent(
      'Budi tidak muncul lagi di pilihan kontak. Utang yang sudah ada tetap tercatat dan tetap bisa dibayar.',
    );
    expect(screen.getByRole('button', { name: 'Kembali' })).toHaveFocus();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Arsipkan' }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
