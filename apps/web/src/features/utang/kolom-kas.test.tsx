import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { KolomKas } from './kolom-kas';

afterEach(cleanup);

describe('KolomKas', () => {
  it('tabel berjudul, baris bertanda, hasil di tfoot', () => {
    render(
      <KolomKas
        caption="Setelah ini"
        rows={[
          { label: 'Sisa sekarang', value: 1_500_000 },
          { label: 'Dibayar', value: -375_000, signed: true },
        ]}
        result={{ label: 'Sisa sesudahnya', value: 1_125_000 }}
      />,
    );
    const table = screen.getByRole('table', { name: 'Setelah ini' });
    expect(within(table).getByRole('rowheader', { name: 'Dibayar' })).toBeInTheDocument();
    expect(table).toHaveTextContent(/−Rp\s375\.000/);
    expect(table.querySelector('tfoot')).toHaveTextContent(/Rp\s1\.125\.000/);
    expect(table.querySelector('tfoot tr')).toHaveClass('border-double');
  });

  it('nilai positif bertanda +, tanpa tfoot bila tanpa hasil', () => {
    render(
      <KolomKas
        caption="Saldo dompet berubah"
        rows={[{ label: 'Saldo BCA', value: 5, signed: true }]}
      />,
    );
    const table = screen.getByRole('table', { name: 'Saldo dompet berubah' });
    expect(table).toHaveTextContent(/\+Rp\s5/);
    expect(table.querySelector('tfoot')).toBeNull();
  });

  it('nominal 12.345.678.900 tidak boleh terpotong (nowrap, tanpa merah)', () => {
    render(
      <KolomKas
        caption="x"
        rows={[{ label: 'Sisa', value: 12_345_678_900 }]}
        result={{ label: 'Hasil', value: 12_345_678_900 }}
      />,
    );
    expect(document.body.innerHTML).not.toContain('text-danger');
    expect(screen.getAllByText(/Rp\s12\.345\.678\.900/)).toHaveLength(2);
  });
});
