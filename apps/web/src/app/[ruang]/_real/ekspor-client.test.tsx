import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportButton } from './ekspor-client';

afterEach(cleanup);

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({ toast: toastSpy }));

const fetchMock = vi.fn();
const clicked: { download: string; href: string }[] = [];

beforeEach(() => {
  toastSpy.mockReset();
  fetchMock.mockReset();
  clicked.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ download: this.download, href: this.href });
  });
});

function setup() {
  render(
    <>
      <p id="hint">Semua transaksi</p>
      <ExportButton
        ruang="pribadi"
        href="/pribadi/laporan/ekspor?periode=2026-11&basis=gajian"
        filename="dompetku-pribadi-2026-11.csv"
        periodTitle="November 2026"
        describedBy="hint"
      />
    </>,
  );
  return screen.getByRole('link', { name: 'Ekspor CSV' });
}

describe('ExportButton (S10-EX1)', () => {
  it('berhasil: fetch, unduh dengan nama berkas, toast tanpa nominal', async () => {
    fetchMock.mockResolvedValue(new Response('﻿x', { status: 200 }));
    const user = userEvent.setup();
    const btn = setup();
    expect(btn).toHaveAccessibleDescription('Semua transaksi');
    await user.click(btn);
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith({ message: 'Ekspor November 2026 · Pribadi selesai' });
    });
    expect(fetchMock).toHaveBeenCalledWith('/pribadi/laporan/ekspor?periode=2026-11&basis=gajian', {
      credentials: 'same-origin',
    });
    expect(clicked).toEqual([{ download: 'dompetku-pribadi-2026-11.csv', href: 'blob:x' }]);
    expect(btn).not.toHaveAttribute('aria-disabled', 'true');
  });

  it.each([
    [429, 'Terlalu sering mengunduh. Coba lagi nanti.'],
    [422, 'Terlalu banyak transaksi untuk satu ekspor. Pilih periode yang lebih pendek.'],
    [500, 'Belum berhasil. Sambungan ke server terputus. Coba lagi.'],
  ])('status %s: toast jelas, tidak ada unduhan', async (status, message) => {
    fetchMock.mockResolvedValue(new Response('x', { status }));
    const user = userEvent.setup();
    await user.click(setup());
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith({ message, tone: 'info' });
    });
    expect(clicked).toHaveLength(0);
  });

  it('jaringan putus: toast galat umum, tombol aktif lagi', async () => {
    fetchMock.mockRejectedValue(new Error('putus'));
    const user = userEvent.setup();
    const btn = setup();
    await user.click(btn);
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith({
        message: 'Belum berhasil. Sambungan ke server terputus. Coba lagi.',
        tone: 'info',
      });
    });
    expect(btn).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('klik ganda saat menyiapkan = satu permintaan', async () => {
    let done: (r: Response) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (done = r)));
    const user = userEvent.setup();
    const btn = setup();
    await user.click(btn);
    await user.click(screen.getByRole('link', { name: 'Menyiapkan…' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    done(new Response('x', { status: 200 }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalled();
    });
  });
});
