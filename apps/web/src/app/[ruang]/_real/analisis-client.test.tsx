import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisOverviewVM } from '@/features/analisis/types';

const m = vi.hoisted(() => ({
  runAnalysisAction: vi.fn(),
}));

vi.mock('../_actions/analisis', () => ({
  runAnalysisAction: m.runAnalysisAction,
}));

import { AnalisisClient } from './analisis-client';

const BASE_DATA: AnalysisOverviewVM = {
  periodChoice: 'current',
  periodLabel: 'November 2026 · 25 Okt – 24 Nov',
  from: '2026-10-25',
  to: '2026-11-24',
  labelMonth: '2026-11-01',
  income: 12_000_000,
  expense: 5_000_000,
  net: 7_000_000,
  previousExpense: 4_500_000,
  safeToSpend: 4_200_000,
  daysLeft: 10,
  topCategories: [{ name: 'Makan & Minum', amount: 2_500_000, pct: 50, entryCount: 12 }],
  hasData: true,
  aiConfigured: true,
  quota: { used: 1, limit: 5, remaining: 4, day: '2026-11-14' },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AnalisisClient (S18)', () => {
  it('merender ringkasan SQL dan menjalankan Analisis AI saat tombol ditekan', async () => {
    m.runAnalysisAction.mockResolvedValueOnce({
      ok: true,
      value: {
        ok: true,
        analysis: {
          ringkasan: 'Pengeluaran periode ini masih terkendali.',
          sorotan: ['Makan & Minum menjadi pos terbesar 50 persen.'],
          saran: ['Pertahankan ritme pengeluaran harian saat ini.'],
          provider: 'gemini',
        },
        quota: { used: 2, limit: 5, remaining: 3, exhausted: false },
      },
    });

    render(<AnalisisClient ruang="pribadi" query="" data={BASE_DATA} />);
    expect(screen.getByText('Makan & Minum')).toBeInTheDocument();
    expect(screen.getByText('Kuota 4 dari 5 hari ini')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Buat analisis AI' }));
    await waitFor(() => {
      expect(screen.getByText('Pengeluaran periode ini masih terkendali.')).toBeInTheDocument();
    });
    expect(screen.getByText('Kuota 3 dari 5 hari ini')).toBeInTheDocument();
    expect(m.runAnalysisAction).toHaveBeenCalledWith('pribadi', { period: 'current' });
  });

  it('menampilkan catatan jujur bila AI belum aktif sambil tetap menampilkan angka SQL', () => {
    render(
      <AnalisisClient ruang="pribadi" query="" data={{ ...BASE_DATA, aiConfigured: false }} />,
    );
    expect(screen.getByText('Makan & Minum')).toBeInTheDocument();
    expect(screen.getByText(/Analisis AI belum aktif di server ini/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buat analisis AI' })).toBeNull();
  });

  it('menampilkan keterangan jujur bila kuota harian 0 dari 5', () => {
    render(
      <AnalisisClient
        ruang="pribadi"
        query=""
        data={{ ...BASE_DATA, quota: { used: 5, limit: 5, remaining: 0, day: '2026-11-14' } }}
      />,
    );
    expect(screen.getByText('Kuota 0 dari 5 hari ini')).toBeInTheDocument();
    expect(screen.getByText(/Kuota analisis AI hari ini sudah terpakai penuh/)).toBeInTheDocument();
  });
});
