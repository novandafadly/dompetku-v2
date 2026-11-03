import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KATEGORI_TITLE_ID } from '@/features/kategori/ids';
import type { CategoryVM } from '@/features/ledger/types';
import { KategoriManager } from './kategori-client';

const actions = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../_actions/kategori', () => ({
  createCategoryAction: actions.create,
  updateCategoryAction: actions.update,
  archiveCategoryAction: actions.archive,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: actions.refresh, back: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/features/shell/nav-provider', () => ({ useNav: () => ({ query: '' }) }));
vi.mock('@/components/ui/toast', () => ({ toast: actions.toast }));

beforeEach(() => {
  vi.clearAllMocks();
});
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
  cat({ id: 'k-gaji', name: 'Gaji', type: 'income', icon: 'Briefcase' }),
];

function setup(categories = CATEGORIES) {
  render(
    <>
      <h1 id={KATEGORI_TITLE_ID} tabIndex={-1}>
        Kategori · Pribadi
      </h1>
      <KategoriManager ruang="pribadi" categories={categories} />
    </>,
  );
}

describe('KategoriManager', () => {
  it('tab Pengeluaran | Pemasukan menukar daftar', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByRole('button', { name: /Makan/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Gaji/ })).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Pemasukan' }));
    expect(screen.getByRole('button', { name: /Gaji/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Makan/ })).toBeNull();
  });

  it('ubah: kirim ganti-penuh ke updateCategoryAction, toast menyebut ruang, fokus kembali ke baris', async () => {
    const user = userEvent.setup();
    actions.update.mockResolvedValue({ ok: true, value: undefined });
    setup();
    await user.click(screen.getByRole('button', { name: /Kopi/ }));
    const name = await screen.findByRole('textbox', { name: 'Nama' });
    await user.clear(name);
    await user.type(name, 'Kopi & Camilan');
    await user.click(screen.getByRole('button', { name: 'Simpan kategori' }));
    await waitFor(() => {
      expect(actions.update).toHaveBeenCalledWith('pribadi', {
        categoryId: 'k-kopi',
        name: 'Kopi & Camilan',
        icon: 'Coffee',
        parentId: 'k-makan',
      });
    });
    await waitFor(() => {
      expect(actions.toast).toHaveBeenCalledWith({
        message: 'Kategori Kopi & Camilan disimpan di Pribadi',
      });
    });
    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: /Kopi/ })).toHaveFocus();
      },
      { timeout: 3000 },
    );
  });

  it('tambah di tab Pemasukan: jenis income, tanpa parentId bila Tanpa induk', async () => {
    const user = userEvent.setup();
    actions.create.mockResolvedValue({ ok: true, value: { categoryId: 'k-baru' } });
    setup();
    await user.click(screen.getByRole('tab', { name: 'Pemasukan' }));
    await user.click(screen.getByRole('button', { name: 'Tambah kategori' }));
    await user.type(await screen.findByRole('textbox', { name: 'Nama' }), 'Bonus');
    await user.click(screen.getByRole('button', { name: 'Simpan kategori' }));
    await waitFor(() => {
      expect(actions.create).toHaveBeenCalledTimes(1);
    });
    expect(actions.create.mock.calls[0]).toEqual([
      'pribadi',
      {
        clientId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
        type: 'income',
        name: 'Bonus',
        icon: 'Tag',
      },
    ]);
  });

  it('nama ganda dari server: tetap di sheet, pesan di kolom Nama', async () => {
    const user = userEvent.setup();
    actions.create.mockResolvedValue({ ok: false, error: { code: 'name_taken' } });
    setup();
    await user.click(screen.getByRole('button', { name: 'Tambah kategori' }));
    await user.type(await screen.findByRole('textbox', { name: 'Nama' }), 'Makan');
    await user.click(screen.getByRole('button', { name: 'Simpan kategori' }));
    expect(
      await screen.findByText('Nama ini sudah dipakai kategori lain di Pribadi.'),
    ).toBeTruthy();
    expect(actions.toast).not.toHaveBeenCalled();
  });

  it('idem_mismatch saat tambah: daftar dimuat ulang (percobaan sebelumnya mungkin sudah tersimpan)', async () => {
    const user = userEvent.setup();
    actions.create.mockResolvedValue({ ok: false, error: { code: 'idem_mismatch' } });
    setup();
    await user.click(screen.getByRole('button', { name: 'Tambah kategori' }));
    await user.type(await screen.findByRole('textbox', { name: 'Nama' }), 'Bonus');
    await user.click(screen.getByRole('button', { name: 'Simpan kategori' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('mungkin sudah tersimpan');
    expect(actions.refresh).toHaveBeenCalledTimes(1);
  });

  it('arsip: dialog menyebut subkategori, fokus awal Kembali; konfirmasi memanggil action, toast, fokus ke judul', async () => {
    const user = userEvent.setup();
    actions.archive.mockResolvedValue({ ok: true, value: { affected: 2 } });
    setup();
    await user.click(screen.getByRole('button', { name: /^Makan/ }));
    await user.click(await screen.findByRole('button', { name: 'Arsipkan kategori' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Arsipkan Makan?' });
    expect(dialog).toHaveAccessibleDescription(/1 subkategori ikut diarsipkan\.$/);
    expect(screen.getByRole('button', { name: 'Kembali' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Arsipkan' }));
    await waitFor(() => {
      expect(actions.archive).toHaveBeenCalledWith('pribadi', { categoryId: 'k-makan' });
    });
    await waitFor(() => {
      expect(actions.toast).toHaveBeenCalledWith({ message: 'Makan diarsipkan di Pribadi' });
    });
    await waitFor(
      () => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
      },
      { timeout: 3000 },
    );
  });

  it('arsip gagal (jaringan): toast pemberitahuan, tanpa toast berhasil', async () => {
    const user = userEvent.setup();
    actions.archive.mockRejectedValue(new Error('putus'));
    setup();
    await user.click(screen.getByRole('button', { name: /Gaji|Makan/ }));
    await user.click(await screen.findByRole('button', { name: 'Arsipkan kategori' }));
    await user.click(await screen.findByRole('button', { name: 'Arsipkan' }));
    await waitFor(() => {
      expect(actions.toast).toHaveBeenCalledWith({
        message: 'Belum bisa diarsipkan. Periksa koneksi lalu coba lagi.',
        tone: 'info',
      });
    });
  });

  it('daftar kosong: Tambah kategori hanya satu (di keadaan kosong)', () => {
    setup([]);
    expect(screen.getByText('Belum ada kategori pengeluaran di Pribadi.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Tambah kategori' })).toHaveLength(1);
  });
});
