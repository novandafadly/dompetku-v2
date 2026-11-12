import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewCopyCard } from './review-client';

afterEach(cleanup);

const copyBudgetsAction = vi.hoisted(() => vi.fn());
vi.mock('../_actions/rencana', () => ({ copyBudgetsAction }));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({ toast: toastSpy }));

const ok = (over: Record<string, number> = {}) => ({
  ok: true,
  value: {
    copied: 3,
    skippedExisting: 0,
    skippedConflict: 0,
    skippedArchived: 0,
    skippedParent: 0,
    ...over,
  },
});

beforeEach(() => {
  copyBudgetsAction.mockReset();
  toastSpy.mockReset();
  copyBudgetsAction.mockResolvedValue(ok());
});

function setup() {
  render(
    <ReviewCopyCard
      ruang="pribadi"
      toMonth="2026-12"
      fromTitle="November 2026"
      toTitle="Desember 2026"
      count={3}
    />,
  );
}
const salin = () => screen.getByRole('button', { name: 'Salin 3 anggaran' });

describe('ReviewCopyCard (S10-RV2)', () => {
  it('bawaan Sama: salin dengan adjustPct 0, toast tanpa penyesuaian', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByRole('heading', { name: 'Siapkan Desember 2026' })).toBeTruthy();
    expect(
      screen.getByText(
        'Salin anggaran November 2026 ke Desember 2026. Yang sudah ada di tujuan tidak ditimpa.',
      ),
    ).toBeTruthy();
    await user.click(salin());
    await waitFor(() => {
      expect(copyBudgetsAction).toHaveBeenCalledWith('pribadi', {
        toMonth: '2026-12',
        adjustPct: 0,
      });
    });
    expect(toastSpy).toHaveBeenCalledWith({
      message: '3 anggaran disalin ke Desember 2026 · Pribadi',
    });
  });

  it('pilihan cepat −10%: persen terkirim, toast menyebut penyesuaian, catatan pembulatan tampil', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('radio', { name: '−10%' }));
    expect(screen.getByText('Dibulatkan ke Rp1.000.')).toBeTruthy();
    await user.click(salin());
    await waitFor(() => {
      expect(copyBudgetsAction).toHaveBeenCalledWith('pribadi', {
        toMonth: '2026-12',
        adjustPct: -10,
      });
    });
    expect((toastSpy.mock.calls[0]?.[0] as { message: string }).message).toContain(
      'disesuaikan −10%',
    );
  });

  it('Lain…: angka di luar −90..100 tidak dikirim dan memberi galat tanpa nominal', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('radio', { name: 'Lain…' }));
    await user.type(screen.getByRole('textbox', { name: 'Penyesuaian (%)' }), '150');
    expect(await screen.findByText('Isi bilangan bulat antara −90 dan 100.')).toBeTruthy();
    await user.click(salin());
    expect(copyBudgetsAction).not.toHaveBeenCalled();
  });

  it('Lain… dengan angka sah dikirim apa adanya', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('radio', { name: 'Lain…' }));
    await user.type(screen.getByRole('textbox', { name: 'Penyesuaian (%)' }), '25');
    await user.click(salin());
    await waitFor(() => {
      expect(copyBudgetsAction).toHaveBeenCalledWith('pribadi', {
        toMonth: '2026-12',
        adjustPct: 25,
      });
    });
  });

  it('semua sudah ada: toast jujur, bukan galat', async () => {
    const user = userEvent.setup();
    copyBudgetsAction.mockResolvedValue(ok({ copied: 0, skippedExisting: 3 }));
    setup();
    await user.click(salin());
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith({
        message: 'Semua anggaran sudah ada di Desember 2026.',
      });
    });
  });

  it('galat jaringan: pesan aman diulang, tombol aktif lagi', async () => {
    const user = userEvent.setup();
    copyBudgetsAction.mockRejectedValue(new Error('putus'));
    setup();
    await user.click(salin());
    expect(await screen.findByText(/^Belum tersalin\. Koneksi terputus/)).toBeTruthy();
    expect(salin()).not.toHaveAttribute('aria-disabled', 'true');
  });
});
