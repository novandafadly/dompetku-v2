import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { goal } from './__fixtures__/goal';
import { ArchiveGoalDialog, CompleteGoalDialog } from './goal-dialogs';

afterEach(cleanup);

describe('CompleteGoalDialog (S13-TJ6)', () => {
  it('judul, isi, fokus awal Kembali, konfirmasi memanggil onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <CompleteGoalDialog
        open
        onOpenChange={vi.fn()}
        goal={goal({ reached: true })}
        busy={false}
        failure={null}
        onConfirm={onConfirm}
      />,
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Selesaikan Dana darurat?' });
    expect(dialog).toHaveTextContent(
      'Tujuan pindah ke Selesai dan diarsipkan. Saldo Tabungan BCA tidak berubah, dan Tabungan BCA bisa dipakai untuk tujuan baru.',
    );
    expect(screen.getByRole('button', { name: 'Kembali' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Selesaikan' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('goal_not_reached: pesan di dialog dan konfirmasi dinonaktifkan', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <CompleteGoalDialog
        open
        onOpenChange={vi.fn()}
        goal={goal({ reached: true })}
        busy={false}
        failure="goal_not_reached"
        onConfirm={onConfirm}
      />,
    );
    expect(
      await screen.findByText('Saldo Tabungan BCA sudah di bawah target lagi. Muat ulang halaman.'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Selesaikan' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('ArchiveGoalDialog (S13-TJ7)', () => {
  const render1 = (partnerName: string | null) =>
    render(
      <ArchiveGoalDialog
        open
        onOpenChange={vi.fn()}
        goal={goal()}
        partnerName={partnerName}
        busy={false}
        failure={null}
        onConfirm={vi.fn()}
      />,
    );

  it('isi dan tombol; Bersama dua anggota menambah kalimat anggota lain', async () => {
    render1('Farida');
    const dialog = await screen.findByRole('alertdialog', { name: 'Arsipkan Dana darurat?' });
    expect(dialog).toHaveTextContent(
      'Tujuan berhenti dilacak. Saldo Tabungan BCA tidak berubah. Kamu bisa memulihkannya dari Selesai dan diarsipkan.',
    );
    expect(dialog).toHaveTextContent('Tujuan ini juga hilang dari Rencana Farida.');
    expect(screen.getByRole('button', { name: 'Arsipkan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kembali' })).toHaveFocus();
  });

  it('Pribadi/solo: tanpa kalimat anggota lain', async () => {
    render1(null);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).not.toContain('juga hilang');
  });
});
