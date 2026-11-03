import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArchiveDialog } from './archive-dialog';

afterEach(cleanup);

function setup(over: Partial<React.ComponentProps<typeof ArchiveDialog>> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ArchiveDialog
      open
      onOpenChange={onOpenChange}
      name="Makan Siang & Minum"
      ruang="pribadi"
      childCount={0}
      onConfirm={onConfirm}
      {...over}
    />,
  );
  return { onConfirm, onOpenChange };
}

describe('ArchiveDialog (S6-K2)', () => {
  it('salinan tetap: judul menyebut nama, deskripsi menyebut Catat {Ruang} dan transaksi lama', () => {
    setup();
    const dialog = screen.getByRole('alertdialog', { name: 'Arsipkan Makan Siang & Minum?' });
    expect(dialog).toHaveAccessibleDescription(
      'Makan Siang & Minum tidak ditawarkan lagi di Catat Pribadi. Transaksi lama tetap memakai kategori ini.',
    );
  });

  it('punya subkategori aktif: menambah kalimat jumlah yang ikut diarsipkan', () => {
    setup({ childCount: 2, ruang: 'bersama' });
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(
      'Makan Siang & Minum tidak ditawarkan lagi di Catat Bersama. Transaksi lama tetap memakai kategori ini. 2 subkategori ikut diarsipkan.',
    );
  });

  it('fokus awal di Kembali (bukan Arsipkan)', async () => {
    setup();
    expect(await screen.findByRole('button', { name: 'Kembali' })).toHaveFocus();
  });

  it('Arsipkan memanggil onConfirm; Kembali tidak', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();
    await user.click(screen.getByRole('button', { name: 'Kembali' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Arsipkan memanggil onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();
    await user.click(screen.getByRole('button', { name: 'Arsipkan' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
