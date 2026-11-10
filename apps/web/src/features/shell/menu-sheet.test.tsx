import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuSheet } from './menu-sheet';

vi.mock('./nav-provider', () => ({
  useNav: () => ({
    ruang: 'bersama',
    query: '',
    sampahHref: (r: string) => `/${r}/sampah`,
    kategoriHref: (r: string) => `/${r}/kategori`,
  }),
}));

vi.mock('@/server/auth/actions', () => ({ signOutAction: vi.fn() }));

afterEach(cleanup);

describe('MenuSheet: Kategori', () => {
  it('mode nyata: Kategori adalah tautan ke /{ruang}/kategori, tanpa "Segera"', () => {
    render(<MenuSheet open onOpenChange={vi.fn()} real />);
    expect(screen.getByRole('link', { name: 'Kategori' })).toHaveAttribute(
      'href',
      '/bersama/kategori',
    );
    // Butir lain yang belum ada tetap "Segera".
    expect(screen.getAllByText('Segera')).toHaveLength(4);
    // Analisis diganti Laporan (S9 K8).
    expect(screen.getByRole('link', { name: 'Laporan' })).toHaveAttribute(
      'href',
      '/bersama/laporan',
    );
  });

  it('prototipe (bawaan): Kategori tetap nonaktif dengan "Segera"', () => {
    render(<MenuSheet open onOpenChange={vi.fn()} />);
    expect(screen.queryByRole('link', { name: 'Kategori' })).toBeNull();
    const item = screen.getByRole('button', { name: /Kategori/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveTextContent('Segera');
    expect(screen.getAllByText('Segera')).toHaveLength(6);
  });

  it('Sampah aktif di kedua mode', () => {
    render(<MenuSheet open onOpenChange={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Sampah' })).toHaveAttribute('href', '/bersama/sampah');
  });
});

describe('MenuSheet: Keluar', () => {
  it('mode nyata: Keluar adalah tombol submit dalam form, baris terakhir daftar', () => {
    render(<MenuSheet open onOpenChange={vi.fn()} real />);
    const btn = screen.getByRole('button', { name: 'Keluar' });
    expect(btn).toHaveAttribute('type', 'submit');
    expect(btn.closest('form')).not.toBeNull();
    const items = screen.getAllByRole('listitem');
    expect(items[items.length - 1]).toContainElement(btn);
    // Bukan butir "Segera": tidak dinonaktifkan.
    expect(btn).not.toHaveAttribute('aria-disabled');
  });

  it('prototipe (bawaan): Keluar tidak ditampilkan', () => {
    render(<MenuSheet open onOpenChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Keluar' })).toBeNull();
  });
});

describe('MenuSheet: WhatsApp', () => {
  it('mode nyata: tautan ke /{ruang}/whatsapp, bukan "Segera"', () => {
    render(<MenuSheet open onOpenChange={vi.fn()} real />);
    const link = screen.getByRole('link', { name: 'WhatsApp' });
    expect(link).toHaveAttribute('href', '/bersama/whatsapp');
    expect(link).not.toHaveTextContent('Segera');
  });

  it('prototipe (bawaan): tidak ada butir WhatsApp sama sekali', () => {
    render(<MenuSheet open onOpenChange={vi.fn()} />);
    expect(screen.queryByText('WhatsApp')).toBeNull();
    expect(screen.queryByRole('link', { name: 'WhatsApp' })).toBeNull();
  });
});
