import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TradingFiguresVM } from '@/features/ledger/types';
import { ModalCard } from './modal-card';

afterEach(cleanup);

const fig = (over: Partial<TradingFiguresVM> = {}): TradingFiguresVM => ({
  balance: 5_000_000,
  capitalIn: 5_000_000,
  capitalOut: 0,
  capitalLeft: 5_000_000,
  realized: 0,
  shortfall: 0,
  hasDeposit: true,
  ...over,
});

describe('ModalCard (S12-TR2/TR3)', () => {
  it('angka dari VM; tanpa baris Hasil ditarik dan tanpa Kurang bila nol', () => {
    render(<ModalCard variant="overview" figures={fig()} />);
    const card = screen.getByRole('region', { name: 'Modal trading' });
    expect(card).toHaveTextContent('Sisa modal');
    expect(card).toHaveTextContent('Saldo trading');
    expect(card).toHaveTextContent('5.000.000');
    expect(card).not.toHaveTextContent('Hasil ditarik');
    expect(card).not.toHaveTextContent('Kurang');
    expect(card).not.toHaveTextContent('Rp 0');
  });

  it('Kurang Rp … dari shortfall SQL, sebagai status peringatan (bukan galat)', () => {
    render(
      <ModalCard variant="overview" figures={fig({ balance: 3_800_000, shortfall: 1_200_000 })} />,
    );
    const warn = screen.getByRole('status');
    expect(warn).toHaveTextContent('Kurang Rp 1.200.000');
    expect(warn).toHaveTextContent('Saldo trading lebih kecil dari sisa modal yang kamu setor.');
    expect(warn.className).toContain('warning-tint');
  });

  it('modal ditarik semua: kalimat, bukan Rp 0; Hasil ditarik tampil bila > 0', () => {
    render(
      <ModalCard
        variant="overview"
        figures={fig({
          capitalIn: 1_000_000,
          capitalOut: 1_500_000,
          capitalLeft: 0,
          realized: 500_000,
          balance: 0,
        })}
      />,
    );
    const card = screen.getByRole('region', { name: 'Modal trading' });
    expect(card).toHaveTextContent('Modal sudah ditarik semua.');
    expect(card).toHaveTextContent('Hasil ditarik');
    expect(card).toHaveTextContent('Penarikan di atas modal yang disetor.');
    expect(card).not.toHaveTextContent('Rp 0');
  });

  it('belum ada setoran: keadaan kosong, tanpa angka', () => {
    render(
      <ModalCard
        variant="overview"
        figures={fig({ hasDeposit: false, capitalIn: 0, capitalLeft: 0, balance: 0 })}
      />,
    );
    expect(screen.getByText(/Belum ada modal yang disetor/)).toBeTruthy();
    expect(screen.queryByText(/Rp/)).toBeNull();
  });

  it('detail: Disetor dan Ditarik, judul Modal', () => {
    render(
      <ModalCard
        variant="detail"
        figures={fig({ capitalOut: 2_000_000, capitalLeft: 3_000_000 })}
      />,
    );
    const card = screen.getByRole('region', { name: 'Modal' });
    expect(card).toHaveTextContent('Disetor');
    expect(card).toHaveTextContent('Ditarik');
  });
});
