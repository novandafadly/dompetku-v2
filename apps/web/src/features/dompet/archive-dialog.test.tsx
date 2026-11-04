import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArchiveBlockedCard } from './archive-blocked-card';
import { ArchiveWalletDialog } from './archive-dialog';

afterEach(cleanup);

function dialog(over: Partial<Parameters<typeof ArchiveWalletDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  render(
    <ArchiveWalletDialog
      open
      onOpenChange={vi.fn()}
      name="BCA"
      ruang="pribadi"
      busy={false}
      failure={null}
      onConfirm={onConfirm}
      {...over}
    />,
  );
  return onConfirm;
}

describe('ArchiveWalletDialog (S7-W3)', () => {
  it('Pribadi: judul, deskripsi dengan ruang, fokus awal di Kembali', async () => {
    dialog();
    const d = await screen.findByRole('alertdialog', { name: 'Arsipkan BCA?' });
    expect(d).toHaveTextContent(
      'BCA tidak ditawarkan lagi di Catat Pribadi. Riwayat transaksinya tetap ada.',
    );
    expect(d).not.toHaveTextContent('dipakai bersama');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Kembali' }));
  });

  it('Bersama: butir tambahan dipakai bersama', async () => {
    dialog({ ruang: 'bersama', name: 'Kas Rumah' });
    const d = await screen.findByRole('alertdialog', { name: 'Arsipkan Kas Rumah?' });
    expect(d).toHaveTextContent('Kas Rumah tidak ditawarkan lagi di Catat Bersama.');
    expect(d).toHaveTextContent(
      'Dompet ini dipakai bersama; anggota lain juga tidak melihatnya di Catat lagi.',
    );
  });

  it('Arsipkan memanggil onConfirm sekali', async () => {
    const user = userEvent.setup();
    const onConfirm = dialog();
    await user.click(await screen.findByRole('button', { name: 'Arsipkan' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('balance_not_zero (race): galat di dalam dialog, tombol Arsipkan aria-disabled dan tak berfungsi', async () => {
    const user = userEvent.setup();
    const onConfirm = dialog({ failure: 'balance_not_zero' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'BCA masih berisi saldo, jadi belum bisa diarsipkan. Pindahkan isinya dulu.',
    );
    const btn = screen.getByRole('button', { name: 'Arsipkan' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toHaveAttribute('aria-busy');
    // Galat tampil: fokus ada di tombol aman, dialog tetap terbuka walau tombol diklik.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Kembali' }));
    await user.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('galat jaringan dan server punya salinan sendiri; Arsipkan tetap bisa dicoba lagi', async () => {
    const { rerender } = render(
      <ArchiveWalletDialog
        open
        onOpenChange={vi.fn()}
        name="BCA"
        ruang="pribadi"
        busy={false}
        failure="network"
        onConfirm={vi.fn()}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Belum bisa diarsipkan. Periksa koneksi lalu coba lagi.',
    );
    expect(screen.getByRole('button', { name: 'Arsipkan' })).not.toHaveAttribute('aria-disabled');
    rerender(
      <ArchiveWalletDialog
        open
        onOpenChange={vi.fn()}
        name="BCA"
        ruang="pribadi"
        busy={false}
        failure="unknown"
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe(
      'Belum bisa diarsipkan. Ada kendala di server.',
    );
  });
});

describe('ArchiveBlockedCard (saldo ≠ 0)', () => {
  it('kartu keterangan statis, bukan alert, tanpa tombol', () => {
    render(<ArchiveBlockedCard name="BCA" />);
    expect(
      screen.getByText('BCA masih berisi saldo. Pindahkan isinya dengan Transfer, lalu arsipkan.'),
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
