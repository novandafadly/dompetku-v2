import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goal } from '@/features/tujuan/__fixtures__/goal';
import {
  AddGoalButton,
  ArchiveGoalButton,
  CompleteGoalButton,
  EditGoalButton,
  RestoreGoalButton,
  TujuanHost,
} from './tujuan-client';

const m = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  complete: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../_actions/tujuan', () => ({
  createGoalAction: m.create,
  updateGoalAction: m.update,
  completeGoalAction: m.complete,
  archiveGoalAction: m.archive,
  restoreGoalAction: m.restore,
}));
vi.mock('@/components/ui/toast', () => ({ toast: m.toast }));

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

const G = goal({ reached: true, pct: 100, saved: 10_000_000, balance: 10_000_000, remaining: 0 });

function host(partnerName: string | null = null) {
  render(
    <TujuanHost
      ruang="bersama"
      today="2026-11-15"
      wallets={[{ id: 'a2', name: 'Tabungan Jago', balance: 0 }]}
      goals={[G]}
      partnerName={partnerName}
    >
      <AddGoalButton variant="primary" />
      <EditGoalButton goalId="g1" name="Dana darurat" />
      <ArchiveGoalButton goalId="g1" name="Dana darurat" />
      <CompleteGoalButton goalId="g1" name="Dana darurat" />
      <RestoreGoalButton goalId="g9" name="Liburan" accountName="Tabungan Jago" />
    </TujuanHost>,
  );
}

function last<T>(xs: T[]): T {
  const v = xs.at(-1);
  if (v === undefined) throw new Error('kosong');
  return v;
}

describe('TujuanHost (S13)', () => {
  it('Tambah: sheet terbuka, simpan memanggil createGoalAction(ruang) dan toast menyebut ruang', async () => {
    const user = userEvent.setup();
    m.create.mockResolvedValue({ ok: true, value: { goalId: 'n', replayed: false } });
    host();
    await user.click(screen.getByRole('button', { name: 'Tambah tujuan' }));
    await user.type(await screen.findByRole('textbox', { name: /Nama tujuan/ }), 'Liburan');
    await user.type(screen.getByRole('textbox', { name: /Target/ }), '5000000');
    await user.click(screen.getByRole('button', { name: 'Simpan tujuan' }));
    await waitFor(() => {
      expect(m.create).toHaveBeenCalled();
    });
    expect(m.create.mock.calls[0]?.[0]).toBe('bersama');
    expect(m.create.mock.calls[0]?.[1]).toMatchObject({
      accountId: 'a2',
      name: 'Liburan',
      target: 5_000_000,
    });
    await waitFor(() => {
      expect(m.toast).toHaveBeenCalledWith({ message: 'Tujuan Liburan dibuat di Bersama' });
    });
  });

  it('Ubah: updateGoalAction membawa goalId; toast diperbarui', async () => {
    const user = userEvent.setup();
    m.update.mockResolvedValue({ ok: true, value: { goalId: 'g1' } });
    host();
    await user.click(screen.getByRole('button', { name: 'Ubah tujuan Dana darurat' }));
    const name = await screen.findByRole('textbox', { name: /Nama tujuan/ });
    await user.clear(name);
    await user.type(name, 'Dana baru');
    await user.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    await waitFor(() => {
      expect(m.update).toHaveBeenCalled();
    });
    expect(m.update.mock.calls[0]?.[1]).toMatchObject({ goalId: 'g1', name: 'Dana baru' });
    await waitFor(() => {
      expect(m.toast).toHaveBeenCalledWith({ message: 'Tujuan Dana baru diperbarui di Bersama' });
    });
  });

  it('Selesaikan: dialog, konfirmasi, toast + Urungkan = restoreGoalAction', async () => {
    const user = userEvent.setup();
    m.complete.mockResolvedValue({ ok: true, value: { goalId: 'g1', status: 'completed' } });
    m.restore.mockResolvedValue({ ok: true, value: { goalId: 'g1', status: 'active' } });
    host();
    await user.click(screen.getByRole('button', { name: 'Selesaikan tujuan Dana darurat' }));
    await user.click(await screen.findByRole('button', { name: 'Selesaikan' }));
    await waitFor(() => {
      expect(m.complete).toHaveBeenCalledWith('bersama', { goalId: 'g1' });
    });
    await waitFor(() => {
      expect(m.toast).toHaveBeenCalled();
    });
    const arg = last(m.toast.mock.calls)[0] as {
      message: string;
      action: { label: string; onAction: () => void };
    };
    expect(arg.message).toBe('Tujuan Dana darurat selesai');
    expect(arg.action.label).toBe('Urungkan');
    arg.action.onAction();
    arg.action.onAction(); // klik ganda = satu panggilan
    await waitFor(() => {
      expect(m.restore).toHaveBeenCalledTimes(1);
    });
    expect(m.restore).toHaveBeenCalledWith('bersama', { goalId: 'g1' });
  });

  it('Selesaikan ditolak goal_not_reached: pesan di dialog, tanpa toast', async () => {
    const user = userEvent.setup();
    m.complete.mockResolvedValue({ ok: false, error: { code: 'goal_not_reached' } });
    host();
    await user.click(screen.getByRole('button', { name: 'Selesaikan tujuan Dana darurat' }));
    await user.click(await screen.findByRole('button', { name: 'Selesaikan' }));
    expect(await screen.findByText(/sudah di bawah target lagi/)).toBeTruthy();
    expect(m.toast).not.toHaveBeenCalled();
  });

  it('Arsipkan (Bersama dua anggota): kalimat anggota lain, toast Diarsipkan + Urungkan', async () => {
    const user = userEvent.setup();
    m.archive.mockResolvedValue({ ok: true, value: { goalId: 'g1', status: 'archived' } });
    host('Farida');
    await user.click(screen.getByRole('button', { name: 'Arsipkan tujuan Dana darurat' }));
    expect(await screen.findByText('Tujuan ini juga hilang dari Rencana Farida.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Arsipkan' }));
    await waitFor(() => {
      expect(m.archive).toHaveBeenCalledWith('bersama', { goalId: 'g1' });
    });
    await waitFor(() => {
      expect(m.toast).toHaveBeenCalled();
    });
    expect((last(m.toast.mock.calls)[0] as { message: string }).message).toBe(
      'Tujuan Dana darurat diarsipkan',
    );
  });

  it('Urungkan gagal goal_exists: toast informatif dengan nama dompet', async () => {
    const user = userEvent.setup();
    m.archive.mockResolvedValue({ ok: true, value: { goalId: 'g1', status: 'archived' } });
    m.restore.mockResolvedValue({ ok: false, error: { code: 'goal_exists' } });
    host();
    await user.click(screen.getByRole('button', { name: 'Arsipkan tujuan Dana darurat' }));
    await user.click(await screen.findByRole('button', { name: 'Arsipkan' }));
    await waitFor(() => {
      expect(m.toast).toHaveBeenCalled();
    });
    (last(m.toast.mock.calls)[0] as { action: { onAction: () => void } }).action.onAction();
    await waitFor(() => {
      expect(m.toast).toHaveBeenCalledWith({
        message: 'Tabungan BCA sudah punya tujuan aktif. Selesaikan atau arsipkan tujuan itu dulu.',
        tone: 'info',
      });
    });
  });

  it('Pulihkan: berhasil = toast aktif lagi; goal_exists = kalimat di bawah baris', async () => {
    const user = userEvent.setup();
    m.restore.mockResolvedValueOnce({ ok: false, error: { code: 'goal_exists' } });
    host();
    await user.click(screen.getByRole('button', { name: 'Pulihkan tujuan Liburan' }));
    expect(
      await screen.findByText(
        'Tabungan Jago sudah punya tujuan aktif. Selesaikan atau arsipkan tujuan itu dulu.',
      ),
    ).toBeTruthy();
    m.restore.mockResolvedValueOnce({ ok: true, value: { goalId: 'g9', status: 'active' } });
    await user.click(screen.getByRole('button', { name: 'Pulihkan tujuan Liburan' }));
    await waitFor(() => {
      expect(m.toast).toHaveBeenCalledWith({ message: 'Tujuan Liburan aktif lagi' });
    });
  });

  it('Pulihkan account_archived: Dompet sudah diarsipkan', async () => {
    const user = userEvent.setup();
    m.restore.mockResolvedValue({ ok: false, error: { code: 'account_archived' } });
    host();
    await user.click(screen.getByRole('button', { name: 'Pulihkan tujuan Liburan' }));
    expect(await screen.findByText('Dompet sudah diarsipkan')).toBeTruthy();
  });
});
