import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KalenderData } from '@/features/rencana/types';
import { KalenderFailed, KalenderReal } from './kalender';

vi.mock('@/features/shell/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock('./transaksi-islands', () => ({
  RetryIsland: () => <button type="button">Coba lagi</button>,
}));

afterEach(cleanup);

const baseData = (over: Partial<KalenderData> = {}): KalenderData => ({
  daysWindow: 30,
  today: '2027-03-10',
  startBalance: 5_000_000,
  lowestBalance: 4_550_000,
  lowestDay: '2027-03-12',
  firstShortDay: null,
  totalBillsCount: 2,
  totalBillsAmount: 450_000,
  days: [
    {
      day: '2027-03-10',
      opening: 5_000_000,
      billsAmount: 150_000,
      billsCount: 1,
      overdueCount: 1,
      closing: 4_850_000,
      short: false,
      bills: [
        {
          billId: 'b1',
          name: 'Listrik',
          amount: 150_000,
          dueOn: '2027-03-05',
          overdue: true,
          projected: false,
        },
      ],
    },
    {
      day: '2027-03-12',
      opening: 4_850_000,
      billsAmount: 300_000,
      billsCount: 1,
      overdueCount: 0,
      closing: 4_550_000,
      short: false,
      bills: [
        {
          billId: 'b2',
          name: 'Sewa',
          amount: 300_000,
          dueOn: '2027-03-12',
          overdue: false,
          projected: true,
        },
      ],
    },
  ],
  ...over,
});

describe('KalenderReal (S16-KL2..KL4)', () => {
  it('menampilkan ringkasan, catatan jujur, pemilih 30/60/90 hari, tagihan terlambat dan perkiraan', () => {
    render(<KalenderReal ruang="pribadi" query="" data={baseData()} />);
    expect(screen.getByRole('link', { name: 'Kembali ke Tagihan' })).toHaveAttribute(
      'href',
      '/pribadi/rencana?bagian=tagihan',
    );
    expect(screen.getByRole('link', { name: '30 hari' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '60 hari' })).toHaveAttribute(
      'href',
      '/pribadi/rencana/kalender?hari=60',
    );
    expect(screen.getByRole('link', { name: '90 hari' })).toHaveAttribute(
      'href',
      '/pribadi/rencana/kalender?hari=90',
    );
    expect(screen.getByText(/Pemasukan belum diproyeksikan/)).toBeInTheDocument();
    expect(screen.getByText('Listrik')).toBeInTheDocument();
    expect(screen.getByText(/Lewat jatuh tempo/)).toBeInTheDocument();
    expect(screen.getByText('Sewa')).toBeInTheDocument();
    expect(screen.getByText('Perkiraan')).toBeInTheDocument();
    expect(screen.queryByText('Kurang')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Rp 0');
  });

  it('menandai keadaan Kurang dengan teks dan status saat saldo turun di bawah nol', () => {
    render(
      <KalenderReal
        ruang="bersama"
        query="?theme=light"
        data={baseData({
          startBalance: 1_000_000,
          lowestBalance: -500_000,
          lowestDay: '2027-03-12',
          firstShortDay: '2027-03-12',
          days: [
            {
              day: '2027-03-12',
              opening: 1_000_000,
              billsAmount: 1_500_000,
              billsCount: 1,
              overdueCount: 0,
              closing: -500_000,
              short: true,
              bills: [
                {
                  billId: 'b3',
                  name: 'Cicilan',
                  amount: 1_500_000,
                  dueOn: '2027-03-12',
                  overdue: false,
                  projected: false,
                },
              ],
            },
          ],
        })}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      /Saldo diperkirakan kurang mulai 12 Mar 2027/,
    );
    expect(screen.getAllByText('Kurang').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/minus Rp 500\.000/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/pengeluaran Rp 500\.000/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '60 hari' })).toHaveAttribute(
      'href',
      '/bersama/rencana/kalender?theme=light&hari=60',
    );
  });

  it('keadaan kosong dan saldo nol tidak menampilkan Rp 0', () => {
    render(
      <KalenderReal
        ruang="pribadi"
        query=""
        data={baseData({
          startBalance: 0,
          lowestBalance: 0,
          totalBillsCount: 0,
          totalBillsAmount: 0,
          days: [
            {
              day: '2027-03-10',
              opening: 0,
              billsAmount: 0,
              billsCount: 0,
              overdueCount: 0,
              closing: 0,
              short: false,
              bills: [],
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('Tidak ada tagihan terjadwal')).toBeInTheDocument();
    expect(screen.getByText('Belum ada saldo')).toBeInTheDocument();
    expect(screen.getByText('Belum ada tagihan')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Rp\s*0\b/);
  });

  it('KalenderFailed menampilkan galat dan tombol Coba lagi', () => {
    render(<KalenderFailed />);
    expect(screen.getByText('Kalender belum bisa dimuat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  });
});
