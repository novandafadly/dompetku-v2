import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SafeToSpendVM } from '@/features/ledger/types';
import { SafeToSpendCard } from './safe-to-spend-view';

const WARN = 'Pengeluaran wajib bulan ini melebihi saldo operasional.';

const vm = (aman: number, extra: Partial<SafeToSpendVM> = {}): SafeToSpendVM => ({
  operasional: aman,
  billsUntilEom: 0,
  budgetWajibRemaining: 0,
  aman,
  ...extra,
});

describe('SafeToSpendCard (kartu utama dari SafeToSpendVM)', () => {
  it('negatif: nominal danger + kotak peringatan, bilah bahaya', () => {
    render(
      <SafeToSpendCard
        ruang="pribadi"
        today="2026-10-31"
        vm={vm(-50_000, { operasional: 100_000, billsUntilEom: 150_000 })}
      />,
    );
    expect(screen.getByTestId('hero-amount')).toHaveClass('text-danger');
    expect(screen.getByText(WARN)).toBeVisible();
    expect(screen.getByRole('img', { name: /melebihi saldo operasional/ })).toBeVisible();
    expect(screen.queryByText(/per hari/)).toBeNull();
  });

  it('positif: per hari sampai akhir bulan WIB, tanpa peringatan', () => {
    render(<SafeToSpendCard ruang="bersama" today="2026-10-22" vm={vm(1_000_000)} />);
    expect(screen.getByTestId('hero-amount')).not.toHaveClass('text-danger');
    expect(screen.queryByText(WARN)).toBeNull();
    // 22–31 Okt = 10 hari.
    expect(screen.getByText(/per hari untuk 10 hari/)).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Aman dipakai bersama sampai 31 Okt' }),
    ).toBeVisible();
  });

  it('bawaan menampilkan rincian lengkap seperti prototipe', () => {
    render(<SafeToSpendCard ruang="pribadi" today="2026-10-31" vm={vm(500_000)} />);
    expect(screen.getByText(/Tagihan s\.d\./)).toBeVisible();
    expect(screen.getByText('Sisa anggaran wajib')).toBeVisible();
  });
});
