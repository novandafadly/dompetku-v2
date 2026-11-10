import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WaLinkView, formatRemaining, type WaViewStatus } from './wa-link-view';

const t = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ toast: t.toast }));

const unlinked: WaViewStatus = { state: 'unlinked', botNumber: '+62 811 0000 111' };
const linked: WaViewStatus = { state: 'linked', masked: '+62 812••••89', botNumber: null };

function setup(status: WaViewStatus, over: Partial<Parameters<typeof WaLinkView>[0]> = {}) {
  const createCode = vi.fn().mockResolvedValue({
    ok: true,
    value: { code: 'K7M2QX', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() },
  });
  const unlink = vi.fn().mockResolvedValue({ ok: true, value: undefined });
  const refresh = vi.fn();
  render(
    <WaLinkView
      status={status}
      createCode={createCode}
      unlink={unlink}
      refresh={refresh}
      {...over}
    />,
  );
  return { createCode, unlink, refresh };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('formatRemaining', () => {
  it('m:ss, bulat ke atas', () => {
    expect(formatRemaining(600_000)).toBe('10:00');
    expect(formatRemaining(61_001)).toBe('1:02');
    expect(formatRemaining(9_000)).toBe('0:09');
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(-5)).toBe('0:00');
  });
});

describe('WaLinkView: belum terhubung', () => {
  it('status, ajakan, dan tombol Buat kode hubung; tanpa Putuskan', () => {
    setup(unlinked);
    expect(screen.getByRole('heading', { name: 'Belum terhubung' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Buat kode hubung' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Putuskan' })).toBeNull();
    expect(screen.queryByText(/rumah tangga/i)).toBeNull();
  });

  it('kode tampil dengan instruksi, nomor bot, dan hitung mundur 10 menit', async () => {
    const user = userEvent.setup();
    const { createCode } = setup(unlinked);
    await user.click(screen.getByRole('button', { name: 'Buat kode hubung' }));
    expect(createCode).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('wa-code')).toHaveTextContent('K7M2QX');
    expect(screen.getByText('+62 811 0000 111')).toBeTruthy();
    expect(screen.getByRole('timer')).toHaveTextContent(/Berlaku (10:00|9:5\d) lagi/);
    expect(screen.getByRole('button', { name: 'Salin pesan' })).toBeTruthy();
  });

  it('tanpa nomor bot: instruksi tetap tampil tanpa nomor', async () => {
    const user = userEvent.setup();
    setup({ state: 'unlinked', botNumber: null });
    await user.click(screen.getByRole('button', { name: 'Buat kode hubung' }));
    expect(await screen.findByText('nomor bot DompetKu')).toBeTruthy();
  });

  it('hitung mundur berjalan lalu kode kedaluwarsa dan hilang dari layar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    setup(unlinked, {
      createCode: vi.fn().mockResolvedValue({
        ok: true,
        value: { code: 'K7M2QX', expiresAt: new Date(Date.now() + 3000).toISOString() },
      }),
    });
    await user.click(screen.getByRole('button', { name: 'Buat kode hubung' }));
    expect(await screen.findByRole('timer')).toHaveTextContent('Berlaku 0:03 lagi');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(screen.getByRole('heading', { name: 'Kode kedaluwarsa' })).toBeTruthy();
    expect(screen.queryByTestId('wa-code')).toBeNull();
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('Salin pesan menulis "hubung KODE" ke papan klip dan memberi kabar', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    setup(unlinked);
    await user.click(screen.getByRole('button', { name: 'Buat kode hubung' }));
    await user.click(await screen.findByRole('button', { name: 'Salin pesan' }));
    expect(writeText).toHaveBeenCalledWith('hubung K7M2QX');
    expect(await screen.findByText('Tersalin')).toBeTruthy();
  });

  it('papan klip menolak: pesan ketik manual', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('x'));
    setup(unlinked);
    await user.click(screen.getByRole('button', { name: 'Buat kode hubung' }));
    await user.click(await screen.findByRole('button', { name: 'Salin pesan' }));
    expect(await screen.findByText('Belum bisa menyalin. Ketik manual.')).toBeTruthy();
  });

  it('galat server dan jaringan: pesan tetap, tidak ada kode', async () => {
    const user = userEvent.setup();
    const createCode = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'unknown' } })
      .mockRejectedValueOnce(new Error('putus'));
    setup(unlinked, { createCode });
    await user.click(screen.getByRole('button', { name: 'Buat kode hubung' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Kode belum bisa dibuat. Ada kendala di server.',
    );
    await user.click(screen.getByRole('button', { name: 'Buat kode hubung' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Periksa koneksi lalu coba lagi.');
    });
    expect(screen.queryByTestId('wa-code')).toBeNull();
  });

  it('kembali ke tab saat kode aktif memuat ulang status', async () => {
    const user = userEvent.setup();
    const { refresh } = setup(unlinked);
    await user.click(screen.getByRole('button', { name: 'Buat kode hubung' }));
    await screen.findByTestId('wa-code');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('WaLinkView: terhubung', () => {
  it('nomor tersamar, tanpa nomor lengkap; Ganti nomor dan Putuskan', () => {
    setup(linked);
    expect(screen.getByRole('heading', { name: 'Terhubung' })).toBeTruthy();
    expect(screen.getByText('+62 812••••89')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ganti nomor' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Putuskan' })).toBeTruthy();
  });

  it('Putuskan minta konfirmasi dulu; Kembali tidak memanggil action', async () => {
    const user = userEvent.setup();
    const { unlink } = setup(linked);
    await user.click(screen.getByRole('button', { name: 'Putuskan' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Putuskan WhatsApp?');
    expect(dialog).toHaveTextContent('+62 812••••89');
    await user.click(screen.getByRole('button', { name: 'Kembali' }));
    expect(unlink).not.toHaveBeenCalled();
  });

  it('konfirmasi memanggil unlink, menutup dialog, kabar, dan kembali ke Belum terhubung', async () => {
    const user = userEvent.setup();
    const { unlink } = setup(linked);
    await user.click(screen.getByRole('button', { name: 'Putuskan' }));
    await screen.findByRole('alertdialog');
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Putuskan' }),
    );
    await waitFor(() => {
      expect(unlink).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(t.toast).toHaveBeenCalledWith({ message: 'WhatsApp diputuskan' });
    expect(screen.getByRole('heading', { name: 'Belum terhubung' })).toBeTruthy();
  });

  it('putus gagal: dialog tetap terbuka dengan pesan galat', async () => {
    const user = userEvent.setup();
    setup(linked, { unlink: vi.fn().mockResolvedValue({ ok: false, error: { code: 'network' } }) });
    await user.click(screen.getByRole('button', { name: 'Putuskan' }));
    await screen.findByRole('alertdialog');
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Putuskan' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Belum bisa diputuskan. Periksa koneksi lalu coba lagi.',
    );
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
});
