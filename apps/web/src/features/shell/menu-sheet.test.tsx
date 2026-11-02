import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuSheet } from './menu-sheet';

vi.mock('./nav-provider', () => ({
  useNav: () => ({
    ruang: 'bersama',
    sampahHref: (r: string) => `/${r}/sampah`,
    kategoriHref: (r: string) => `/${r}/kategori`,
  }),
}));

afterEach(cleanup);

describe('MenuSheet: Kategori', () => {
  it('mode nyata: Kategori adalah tautan ke /{ruang}/kategori, tanpa "Segera"', () => {
    render(<MenuSheet open onOpenChange={vi.fn()} real />);
    expect(screen.getByRole('link', { name: 'Kategori' })).toHaveAttribute(
      'href',
      '/bersama/kategori',
    );
    // Butir lain yang belum ada tetap "Segera".
    expect(screen.getAllByText('Segera')).toHaveLength(5);
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
