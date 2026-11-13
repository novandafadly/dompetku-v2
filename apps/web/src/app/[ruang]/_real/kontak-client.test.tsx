import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactVM } from '@/features/utang/types';
import { AddContactButton, ContactRowTrigger, KontakHost } from './kontak-client';
import { KONTAK_TITLE_ID } from './utang-ids';

const m = vi.hoisted(() => ({
  create: vi.fn(),
  rename: vi.fn(),
  archive: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../_actions/utang', () => ({
  createContactAction: m.create,
  renameContactAction: m.rename,
  archiveContactAction: m.archive,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh, push: vi.fn() }) }));
vi.mock('@/components/ui/toast', () => ({ toast: m.toast }));

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

const BUDI: ContactVM = {
  contactId: 'c1',
  name: 'Budi',
  borrowedRemaining: 100_000,
  lentRemaining: 0,
  borrowedCount: 1,
  lentCount: 0,
};

function setup() {
  render(
    <KontakHost ruang="pribadi" contacts={[BUDI]}>
      <h1 id={KONTAK_TITLE_ID} tabIndex={-1}>
        Kontak · Pribadi
      </h1>
      <AddContactButton variant="secondary" plus />
      <ContactRowTrigger contactId="c1" className="flex">
        Ubah kontak Budi
      </ContactRowTrigger>
    </KontakHost>,
  );
}

describe('KontakHost', () => {
  it('Tambah kontak: kirim ke Server Action Pribadi dengan clientId, toast, sheet menutup', async () => {
    const user = userEvent.setup();
    m.create.mockResolvedValue({
      ok: true,
      value: { contactId: 'n', name: 'Dewi', replayed: false },
    });
    setup();
    await user.click(screen.getByRole('button', { name: 'Tambah kontak' }));
    await user.type(await screen.findByRole('textbox', { name: 'Nama' }), 'Dewi');
    await user.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => {
      expect(m.create).toHaveBeenCalledWith('pribadi', {
        clientId: expect.any(String) as string,
        name: 'Dewi',
      });
    });
    await waitFor(() => {
      expect(m.toast).toHaveBeenCalledWith({ message: 'Kontak Dewi disimpan · Pribadi' });
    });
  });

  it('Ubah: ganti nama lewat renameContactAction', async () => {
    const user = userEvent.setup();
    m.rename.mockResolvedValue({ ok: true, value: { contactId: 'c1', name: 'Budi S' } });
    setup();
    await user.click(screen.getByRole('button', { name: 'Ubah kontak Budi' }));
    const name = await screen.findByRole('textbox', { name: 'Nama' });
    await user.clear(name);
    await user.type(name, 'Budi S');
    await user.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => {
      expect(m.rename).toHaveBeenCalledWith('pribadi', { contactId: 'c1', name: 'Budi S' });
    });
  });

  it('Arsipkan kontak: sheet diganti dialog, konfirmasi memanggil archive dan toast', async () => {
    const user = userEvent.setup();
    m.archive.mockResolvedValue({ ok: true, value: { contactId: 'c1' } });
    setup();
    await user.click(screen.getByRole('button', { name: 'Ubah kontak Budi' }));
    await user.click(await screen.findByRole('button', { name: 'Arsipkan kontak' }));
    expect(await screen.findByRole('alertdialog', { name: 'Arsipkan Budi?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Arsipkan' }));
    await waitFor(() => {
      expect(m.archive).toHaveBeenCalledWith('pribadi', { contactId: 'c1' });
    });
    await waitFor(() => {
      expect(m.toast).toHaveBeenCalledWith({ message: 'Budi diarsipkan' });
    });
  });
});
