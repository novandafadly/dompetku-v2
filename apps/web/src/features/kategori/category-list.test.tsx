import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CategoryVM } from '@/features/ledger/types';
import { CategoryList } from './category-list';

afterEach(cleanup);

const cat = (over: Partial<CategoryVM> & Pick<CategoryVM, 'id' | 'name'>): CategoryVM => ({
  parentId: null,
  type: 'expense',
  icon: 'Tag',
  archived: false,
  ...over,
});

const ALL: CategoryVM[] = [
  cat({ id: 'k-belanja', name: 'Belanja Dapur', icon: 'ShoppingCart' }),
  cat({ id: 'k-sayur', name: 'Sayur & Buah', icon: 'Carrot', parentId: 'k-belanja' }),
  cat({ id: 'k-makan', name: 'Makan di Luar', icon: 'ForkKnife' }),
  cat({ id: 'k-gaji', name: 'Kontribusi', type: 'income', icon: 'HandCoins' }),
];

describe('CategoryList (S6-K1)', () => {
  it('satu jenis saja; anak bersarang di bawah induknya (ul bersarang)', () => {
    render(
      <CategoryList
        ruang="bersama"
        type="expense"
        categories={ALL}
        onOpen={vi.fn()}
        onAdd={vi.fn()}
      />,
    );
    const list = screen.getByRole('list', { name: 'Kategori pengeluaran' });
    expect(within(list).queryByText('Kontribusi')).toBeNull();
    const nested = within(list).getByRole('list', { name: 'Subkategori Belanja Dapur' });
    expect(within(nested).getByRole('button', { name: /Sayur & Buah/ })).toBeTruthy();
    // Anak tidak muncul sebagai baris akar.
    expect(within(list).getAllByRole('button')).toHaveLength(3);
  });

  it('baris adalah tombol yang membuka kategori itu; target ≥ 52 px', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <CategoryList
        ruang="bersama"
        type="expense"
        categories={ALL}
        onOpen={onOpen}
        onAdd={vi.fn()}
      />,
    );
    const row = screen.getByRole('button', { name: /Makan di Luar/ });
    expect(row.className).toContain('min-h-13');
    await user.click(row);
    expect(onOpen).toHaveBeenCalledWith(ALL[2]);
  });

  it('kosong: salinan tetap dengan ruang + Tambah kategori', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <CategoryList ruang="pribadi" type="income" categories={[]} onOpen={vi.fn()} onAdd={onAdd} />,
    );
    expect(screen.getByText('Belum ada kategori pemasukan di Pribadi.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Tambah kategori' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
