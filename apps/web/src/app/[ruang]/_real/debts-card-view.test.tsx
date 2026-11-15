import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DebtsCard } from './debts-card-view';

afterEach(cleanup);

describe('DebtsCard (S12-UT1)', () => {
  it('utang saja: judul, Sisa utang, jumlah aktif, kalimat Aman dipakai, tautan ke segmen Utang', () => {
    render(
      <DebtsCard
        ruang="pribadi"
        query=""
        data={{ borrowed: 1_250_000, lent: 0, activeCount: 2 }}
      />,
    );
    const card = screen.getByRole('region', { name: 'Utang yang harus dibayar' });
    expect(within(card).getByText('Sisa utang')).toBeTruthy();
    expect(card).toHaveTextContent(/Rp\s1\.250\.000/);
    expect(within(card).getByText('2 utang aktif')).toBeTruthy();
    expect(within(card).getByText('Tidak mengurangi angka Aman dipakai.')).toBeTruthy();
    expect(within(card).queryByText('Piutang')).toBeNull();
    expect(within(card).getByRole('link', { name: 'Lihat utang' }).getAttribute('href')).toBe(
      '/pribadi/rencana?bagian=utang',
    );
  });

  it('piutang saja: judul Piutang yang masih ditagih, tanpa kalimat Aman dipakai, tanpa Sisa utang', () => {
    render(
      <DebtsCard ruang="pribadi" query="" data={{ borrowed: 0, lent: 750_000, activeCount: 1 }} />,
    );
    const card = screen.getByRole('region', { name: 'Piutang yang masih ditagih' });
    expect(within(card).getByText('Piutang')).toBeTruthy();
    expect(within(card).getByText('1 piutang aktif')).toBeTruthy();
    expect(within(card).queryByText('Sisa utang')).toBeNull();
    expect(card.textContent).not.toContain('Aman dipakai');
  });

  it('dua arah: dua baris, jumlah aktif tidak ditampilkan (SQL satu hitungan); tema ikut tautan', () => {
    render(
      <DebtsCard
        ruang="pribadi"
        query="?theme=light"
        data={{ borrowed: 900_000, lent: 100_000, activeCount: 3 }}
      />,
    );
    const card = screen.getByRole('region', { name: 'Utang yang harus dibayar' });
    expect(within(card).getByText('Sisa utang')).toBeTruthy();
    expect(within(card).getByText('Piutang')).toBeTruthy();
    expect(card.textContent).not.toMatch(/aktif/);
    expect(within(card).getByRole('link', { name: 'Lihat utang' }).getAttribute('href')).toBe(
      '/pribadi/rencana?theme=light&bagian=utang',
    );
  });

  it('netral: tanpa kelas warna bahaya/pemasukan dan tanpa "Rp 0"', () => {
    const { container } = render(
      <DebtsCard ruang="pribadi" query="" data={{ borrowed: 5_000, lent: 0, activeCount: 1 }} />,
    );
    expect(container.innerHTML).not.toMatch(/text-(danger|income|expense)/);
    expect(container.textContent).not.toMatch(/Rp\s0(?!\d|\.)/);
    expect(container.textContent).not.toMatch(/hutang/i);
  });
});
