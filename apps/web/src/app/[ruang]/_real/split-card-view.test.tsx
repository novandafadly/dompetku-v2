import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SplitBalanceVM } from '@/features/ledger/patungan-types';
import { SplitCard, SplitCardError } from './split-card-view';

afterEach(cleanup);

const N = { id: 'n', name: 'Novanda', initial: 'N' };
const F = { id: 'f', name: 'Farida', initial: 'F' };

const vm = (over: Partial<SplitBalanceVM> = {}): SplitBalanceVM => ({
  me: N,
  partner: F,
  debtorId: 'f',
  creditorId: 'n',
  amount: 200_000,
  splitCount: 3,
  settlementCount: 1,
  pending: [],
  ...over,
});

describe('SplitCard (S12-PT1)', () => {
  it('belum pernah ada patungan: tidak dirender', () => {
    const { container } = render(
      <SplitCard vm={vm({ splitCount: 0, settlementCount: 0 })} query="" />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('pemberi piutang: kalimat dari SQL, jumlah tagihan/pelunasan, tanpa Lunasi', () => {
    render(<SplitCard vm={vm()} query="" />);
    const card = screen.getByRole('region', { name: 'Saldo patungan' });
    expect(card).toHaveTextContent('Farida berutang Rp 200.000 ke kamu');
    expect(card).toHaveTextContent('Dari 3 tagihan patungan dan 1 pelunasan.');
    expect(within(card).queryByRole('link', { name: /Lunasi/ })).toBeNull();
    expect(within(card).getByRole('link', { name: 'Lihat patungan' }).getAttribute('href')).toBe(
      '/bersama/patungan',
    );
  });

  it('pengutang: tombol Lunasi (tautan ke halaman Patungan) bernama lengkap', () => {
    render(<SplitCard vm={vm({ debtorId: 'n', creditorId: 'f' })} query="?theme=light" />);
    const card = screen.getByRole('region', { name: 'Saldo patungan' });
    expect(card).toHaveTextContent('Kamu berutang Rp 200.000 ke Farida');
    const settle = within(card).getByRole('link', { name: 'Lunasi patungan ke Farida' });
    expect(settle.getAttribute('href')).toBe('/bersama/patungan?theme=light&lunasi=1');
  });

  it('impas: ikon + teks, tanpa nominal dan tanpa Rp 0', () => {
    const { container } = render(
      <SplitCard vm={vm({ debtorId: null, creditorId: null, amount: null })} query="" />,
    );
    expect(screen.getByText('Patungan impas')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Rp/);
  });

  it('pelunasan menunggu diterima olehku: kalimat dan tautan Terima', () => {
    render(
      <SplitCard
        vm={vm({
          pending: [
            { id: 'p1', fromId: 'f', toId: 'n', amount: 150_000, occurredOn: '2026-11-13' },
          ],
        })}
        query=""
      />,
    );
    const card = screen.getByRole('region', { name: 'Saldo patungan' });
    expect(card).toHaveTextContent('Farida sudah melunasi Rp 150.000. Terima ke dompet?');
    expect(within(card).getByRole('link', { name: 'Terima' }).getAttribute('href')).toBe(
      '/bersama/patungan?terima=p1',
    );
  });

  it('netral: tanpa kelas bahaya/pemasukan; tidak menyebut rumah tangga atau dompet pribadi mana pun', () => {
    const { container } = render(<SplitCard vm={vm()} query="" />);
    expect(container.innerHTML).not.toMatch(/text-(danger|income|expense)/);
    expect(container.textContent).not.toMatch(/rumah tangga|Patungan\b.*dompet/i);
  });

  it('galat bacaan: kartu galat dengan Coba lagi', () => {
    render(<SplitCardError retryHref="/bersama/beranda" />);
    expect(screen.getByText('Saldo patungan belum bisa dimuat.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Coba lagi' }).getAttribute('href')).toBe(
      '/bersama/beranda',
    );
  });
});
