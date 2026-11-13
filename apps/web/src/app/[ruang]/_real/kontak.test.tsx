import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContactVM } from '@/features/utang/types';
import { KontakFailed, KontakLoading, KontakReal } from './kontak';

afterEach(cleanup);

vi.mock('./kontak-islands', () => ({
  KontakHostIsland: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContactRowIsland: ({
    contactId,
    className,
    children,
  }: {
    contactId: string;
    className: string;
    children: ReactNode;
  }) => (
    <button type="button" data-contact-row={contactId} className={className}>
      {children}
    </button>
  ),
  AddContactIsland: ({ variant }: { variant: string }) => (
    <button type="button" data-variant={variant}>
      Tambah kontak
    </button>
  ),
}));
vi.mock('./kategori-islands', () => ({
  KategoriBackIsland: () => <button type="button">Menu</button>,
}));
vi.mock('./transaksi-islands', () => ({
  RetryIsland: () => <button type="button">Coba lagi</button>,
}));

const contact = (over: Partial<ContactVM> & { contactId: string; name: string }): ContactVM => ({
  borrowedRemaining: 0,
  lentRemaining: 0,
  borrowedCount: 0,
  lentCount: 0,
  ...over,
});

describe('KontakReal (S11-KT1)', () => {
  it('judul Kontak · Pribadi, baris dengan ringkasan sisa per arah, tanpa merah', () => {
    render(
      <KontakReal
        ruang="pribadi"
        contacts={[
          contact({
            contactId: 'a',
            name: 'Ani',
            borrowedRemaining: 1_500_000,
            lentRemaining: 300_000,
          }),
          contact({ contactId: 'b', name: 'Budi' }),
          contact({ contactId: 'c', name: 'Citra', lentRemaining: 12_345_678_900 }),
        ]}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Kontak · Pribadi' })).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(/Ani.*Saya berutang Rp\s1\.500\.000.*Piutang Rp\s300\.000/);
    expect(rows[1]).toHaveTextContent('Tidak ada utang aktif');
    expect(rows[2]).toHaveTextContent(/Piutang Rp\s12\.345\.678\.900/);
    expect(within(rows[2] ?? document.body).queryByText(/Saya berutang/)).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Ubah kontak / })).toHaveLength(3);
    expect(document.body.innerHTML).not.toContain('text-danger');
  });

  it('kosong: EmptyState dengan Tambah kontak utama, tanpa daftar', () => {
    render(<KontakReal ruang="pribadi" contacts={[]} />);
    expect(screen.getByRole('heading', { name: 'Belum ada kontak.' })).toBeTruthy();
    expect(
      screen.getByText('Kontak dibuat saat kamu mencatat utang, atau dari sini.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tambah kontak' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('galat memuat dan memuat', () => {
    const { unmount } = render(<KontakFailed ruang="pribadi" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Kontak belum bisa dimuat.');
    unmount();
    render(<KontakLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Memuat kontak…');
    expect(document.body.textContent).not.toMatch(/Pribadi/);
  });
});
