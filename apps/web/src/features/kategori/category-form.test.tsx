import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CategoryVM } from '@/features/ledger/types';
import { CategoryForm, type CategoryFormProps, type CategorySubmit } from './category-form';

afterEach(cleanup);

const cat = (over: Partial<CategoryVM> & Pick<CategoryVM, 'id' | 'name'>): CategoryVM => ({
  parentId: null,
  type: 'expense',
  icon: 'Tag',
  archived: false,
  ...over,
});

const CATEGORIES: CategoryVM[] = [
  cat({ id: 'k-makan', name: 'Makan', icon: 'ForkKnife' }),
  cat({ id: 'k-kopi', name: 'Kopi', icon: 'Coffee', parentId: 'k-makan' }),
  cat({ id: 'k-motor', name: 'Motor', icon: 'Motorcycle' }),
  cat({ id: 'k-gaji', name: 'Gaji', type: 'income', icon: 'Briefcase' }),
];

const byId = (id: string): CategoryVM => {
  const c = CATEGORIES.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function setup(over: Partial<CategoryFormProps> = {}) {
  const onSubmit = vi.fn<CategoryFormProps['onSubmit']>(() => Promise.resolve({ ok: true }));
  const onOpenChange = vi.fn();
  const onArchive = vi.fn();
  render(
    <CategoryForm
      open
      onOpenChange={onOpenChange}
      ruang="pribadi"
      mode={{ kind: 'add', type: 'expense' }}
      categories={CATEGORIES}
      onSubmit={onSubmit}
      onArchive={onArchive}
      {...over}
    />,
  );
  return { onSubmit, onOpenChange, onArchive };
}

const save = () => screen.getByRole('button', { name: 'Simpan kategori' });

describe('CategoryForm (S6-K1)', () => {
  it('judul memuat ruang; mode tambah tanpa tombol Arsipkan', async () => {
    setup();
    expect(
      await screen.findByRole('dialog', { name: /^Tambah kategori\s*Pribadi$/i }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Arsipkan kategori' })).toBeNull();
  });

  it('nama kosong: pesan di bawah field, field ditandai, fokus ke field, tidak mengirim', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    const name = await screen.findByRole('textbox', { name: 'Nama' });
    await user.click(save());
    const msg = screen.getByText('Nama kategori wajib diisi.');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name.getAttribute('aria-describedby')).toContain(msg.id);
    expect(name).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('nama hanya spasi ditolak seperti kosong', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await user.type(await screen.findByRole('textbox', { name: 'Nama' }), '   ');
    await user.click(save());
    expect(screen.getByText('Nama kategori wajib diisi.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('nama 41 karakter ditolak (40 diterima)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    const name = await screen.findByRole('textbox', { name: 'Nama' });
    // Batas diterapkan di input (maxLength) dan lagi saat simpan (nilai bisa masuk lewat cara lain).
    expect(name).toHaveAttribute('maxlength', '40');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(name, { target: { value: 'a'.repeat(41) } });
    await user.click(save());
    expect(screen.getByText('Nama kategori maksimal 40 karakter.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: 'a'.repeat(40) } });
    await user.click(save());
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  it('tambah: kirim nama terpangkas, ikon terpilih, induk, dan clientId UUID v4', async () => {
    const user = userEvent.setup();
    const { onSubmit, onOpenChange } = setup();
    await user.type(await screen.findByRole('textbox', { name: 'Nama' }), '  Parkir  ');
    await user.click(screen.getByRole('radio', { name: 'Bensin' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Induk' }), 'k-motor');
    await user.click(save());
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      clientId: expect.stringMatching(UUID_V4) as unknown,
      name: 'Parkir',
      icon: 'GasPump',
      parentId: 'k-motor',
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('Induk hanya menawarkan kategori akar sejenis; kategori lain jenis tidak ada', async () => {
    setup();
    const select = await screen.findByRole('combobox', { name: 'Induk' });
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toEqual(['Tanpa induk', 'Makan', 'Motor']);
  });

  it('ubah: terisi nilai sekarang; induk tidak termasuk dirinya; ikon bawaan lama tetap terkirim bila tak diubah', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({
      mode: { kind: 'edit', category: byId('k-motor') },
    });
    expect(await screen.findByRole('dialog', { name: /^Ubah kategori\s*Pribadi$/i })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Nama' })).toHaveValue('Motor');
    // 'Motorcycle' belum punya ubin sendiri: ubin terdekat (Kendaraan) tampak terpilih.
    expect(screen.getByRole('radio', { name: 'Kendaraan' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const options = Array.from(
      screen.getByRole('combobox', { name: 'Induk' }).querySelectorAll('option'),
    ).map((o) => o.textContent);
    expect(options).toEqual(['Tanpa induk', 'Makan']);
    await user.click(save());
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      name: 'Motor',
      icon: 'Motorcycle',
      parentId: null,
    });
  });

  it('kategori yang punya subkategori: Induk tidak tersedia', async () => {
    setup({ mode: { kind: 'edit', category: byId('k-makan') } });
    const select = await screen.findByRole('combobox', { name: 'Induk' });
    expect(select).toBeDisabled();
    expect(screen.getByText(/punya subkategori/i)).toBeTruthy();
  });

  it('mode ubah: Arsipkan kategori memanggil onArchive', async () => {
    const user = userEvent.setup();
    const { onArchive } = setup({ mode: { kind: 'edit', category: byId('k-motor') } });
    await user.click(await screen.findByRole('button', { name: 'Arsipkan kategori' }));
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it('nama ganda dari server: pesan di kolom Nama (menyebut ruang), fokus ke Nama, sheet tetap', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = setup({
      ruang: 'bersama',
      onSubmit: () => Promise.resolve({ ok: false, code: 'name_taken' }),
    });
    const name = await screen.findByRole('textbox', { name: 'Nama' });
    await user.type(name, 'Makan');
    await user.click(save());
    expect(
      await screen.findByText('Nama ini sudah dipakai kategori lain di Bersama.'),
    ).toBeTruthy();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('kedalaman: pesan di kolom Induk, fokus ke Induk', async () => {
    const user = userEvent.setup();
    setup({ onSubmit: () => Promise.resolve({ ok: false, code: 'category_depth' }) });
    await user.type(await screen.findByRole('textbox', { name: 'Nama' }), 'Parkir');
    await user.click(save());
    const select = screen.getByRole('combobox', { name: 'Induk' });
    expect(await screen.findByText('Kategori hanya bisa dua tingkat.')).toBeTruthy();
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveFocus();
  });

  it('galat jaringan: peringatan dengan Coba lagi memakai clientId yang sama; ganti isian = clientId baru', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<CategoryFormProps['onSubmit']>()
      .mockResolvedValueOnce({ ok: false, code: 'network' })
      .mockResolvedValueOnce({ ok: false, code: 'network' })
      .mockResolvedValue({ ok: true });
    setup({ onSubmit });
    await user.type(await screen.findByRole('textbox', { name: 'Nama' }), 'Parkir');
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('Belum tersimpan.');
    await user.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(2);
    });
    const [first, second] = onSubmit.mock.calls.map((c: [CategorySubmit]) => c[0]);
    expect(second?.clientId).toBe(first?.clientId);
    await user.type(screen.getByRole('textbox', { name: 'Nama' }), 's');
    await user.click(save());
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(3);
    });
    expect(onSubmit.mock.calls[2]?.[0].clientId).not.toBe(first?.clientId);
  });

  it('sibuk menyimpan: tombol nonaktif bertuliskan Menyimpan… dan aria-busy; klik ganda = satu kiriman', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const onSubmit = vi.fn<CategoryFormProps['onSubmit']>(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ ok: true });
          };
        }),
    );
    setup({ onSubmit });
    await user.type(await screen.findByRole('textbox', { name: 'Nama' }), 'Parkir');
    await user.dblClick(save());
    const busy = screen.getByRole('button', { name: /Menyimpan/ });
    // Tidak `disabled` (fokus tidak jatuh ke <body>, R8): nonaktif = aria-disabled + aria-busy.
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    release();
  });
});
