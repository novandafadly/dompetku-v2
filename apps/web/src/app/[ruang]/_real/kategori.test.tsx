import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CategoryVM } from '@/features/ledger/types';
import { KategoriFailed, KategoriReal } from './kategori';

afterEach(cleanup);

const island = vi.hoisted(() => vi.fn());
vi.mock('./kategori-islands', () => ({
  KategoriManagerIsland: (props: unknown) => {
    island(props);
    return <p>daftar</p>;
  },
  KategoriBackIsland: () => <button type="button">Menu</button>,
}));
vi.mock('./transaksi-islands', () => ({
  RetryIsland: () => <button type="button">Coba lagi</button>,
}));

const categories: CategoryVM[] = [
  { id: 'k1', parentId: null, name: 'Makan', type: 'expense', icon: 'ForkKnife', archived: false },
];

describe('KategoriReal', () => {
  it('H1 memuat ruang dan bisa difokus (sesudah arsip); pulau menerima kategori ruang ini', () => {
    render(<KategoriReal ruang="bersama" categories={categories} />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Kategori · Bersama');
    expect(h1).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy();
    expect(island).toHaveBeenCalledWith({ ruang: 'bersama', categories });
  });
});

describe('KategoriFailed', () => {
  it('salinan gagal muat + Coba lagi, tanpa data', () => {
    render(<KategoriFailed ruang="pribadi" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Kategori belum bisa dimuat.');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Kategori · Pribadi');
  });
});
