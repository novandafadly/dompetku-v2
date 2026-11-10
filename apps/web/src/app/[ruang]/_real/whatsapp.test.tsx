import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsappFailed, WhatsappReal } from './whatsapp';

afterEach(cleanup);

const island = vi.hoisted(() => vi.fn());
vi.mock('./whatsapp-islands', () => ({
  WhatsappManagerIsland: (props: unknown) => {
    island(props);
    return <p>pengelola</p>;
  },
  WhatsappBackIsland: () => <button type="button">Menu</button>,
}));
vi.mock('./transaksi-islands', () => ({
  RetryIsland: () => <button type="button">Coba lagi</button>,
}));

describe('WhatsappReal', () => {
  it('fitur mati: keadaan tenang, tanpa pengelola dan tanpa tombol Hubungkan', () => {
    island.mockClear();
    render(<WhatsappReal ruang="pribadi" status={{ state: 'off' }} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('WhatsApp');
    expect(screen.getByText('Catat lewat WhatsApp belum aktif.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Buat kode|Hubung/ })).toBeNull();
    expect(island).not.toHaveBeenCalled();
  });

  it('nomor bot belum diatur: keadaan tenang, tanpa pengelola dan tanpa Hubungkan', () => {
    island.mockClear();
    render(<WhatsappReal ruang="pribadi" status={{ state: 'nobot' }} />);
    expect(screen.getByText('Nomor bot belum diatur.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Buat kode|Hubung/ })).toBeNull();
    expect(island).not.toHaveBeenCalled();
  });

  it('aktif: pulau menerima status yang sudah tersamar; H1 bisa difokus', () => {
    island.mockClear();
    const status = { state: 'linked', masked: '+62 812••••89', botNumber: null } as const;
    render(<WhatsappReal ruang="bersama" status={status} />);
    expect(island).toHaveBeenCalledWith({ status });
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('tabindex', '-1');
  });
});

describe('WhatsappFailed', () => {
  it('gagal muat + Coba lagi, tanpa data', () => {
    render(<WhatsappFailed ruang="pribadi" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Status WhatsApp belum bisa dimuat.');
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
  });
});
