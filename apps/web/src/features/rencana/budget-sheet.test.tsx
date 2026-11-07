import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BudgetSheet, type BudgetResult, type BudgetSubmit } from './budget-sheet';
import type { BudgetOverviewVM } from './types';

afterEach(cleanup);

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({ toast: toastSpy }));

const row = (over: Partial<BudgetOverviewVM> & Pick<BudgetOverviewVM, 'categoryId' | 'name'>) =>
  ({
    icon: 'Tag',
    budget: null,
    wajib: false,
    spent: 0,
    pct: null,
    remaining: null,
    archived: false,
    ...over,
  }) satisfies BudgetOverviewVM;

const ROWS: BudgetOverviewVM[] = [
  row({ categoryId: 'k-listrik', name: 'Listrik & Air' }),
  row({ categoryId: 'k-internet', name: 'Internet' }),
  row({
    categoryId: 'k-sewa',
    name: 'Sewa Rumah',
    budget: 2_500_000,
    wajib: true,
    spent: 500_000,
    pct: 20,
    remaining: 2_000_000,
  }),
  row({
    categoryId: 'k-lama',
    name: 'Kategori Lama',
    budget: 100_000,
    spent: 0,
    pct: 0,
    remaining: 100_000,
    archived: true,
  }),
];

function setup(
  over: Partial<React.ComponentProps<typeof BudgetSheet>> = {},
  result: BudgetResult = { ok: true },
) {
  const onSubmit = vi.fn<(i: BudgetSubmit) => Promise<BudgetResult>>(() => Promise.resolve(result));
  const onDelete = vi.fn<(id: string) => Promise<BudgetResult>>(() =>
    Promise.resolve({ ok: true }),
  );
  const onOpenChange = vi.fn();
  render(
    <BudgetSheet
      open
      onOpenChange={onOpenChange}
      ruang="pribadi"
      rows={ROWS}
      categoryId={null}
      range="23 Okt – 24 Nov"
      previous={{ 'k-internet': 350_000 }}
      billNameByRoot={{ 'k-listrik': 'Listrik PLN' }}
      onSubmit={onSubmit}
      onDelete={onDelete}
      {...over}
    />,
  );
  return { onSubmit, onDelete, onOpenChange };
}

const save = () => screen.getByRole('button', { name: 'Simpan anggaran' });
const category = () => screen.getByRole('combobox', { name: 'Kategori' });
const amount = () => screen.getByRole('textbox', { name: 'Anggaran periode ini' });
const wajib = () => screen.getByRole('switch', { name: 'Wajib' });

describe('BudgetSheet (S9-AN2): tambah', () => {
  it('judul menyebut ruang; hanya induk aktif tanpa anggaran ada di pilihan; fokus awal di Kategori', async () => {
    setup();
    expect(await screen.findByRole('dialog', { name: /^Anggaran\s*Pribadi$/ })).toBeTruthy();
    const options = within(category())
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Pilih kategori', 'Listrik & Air', 'Internet']);
    expect(category()).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Hapus anggaran' })).toBeNull();
    expect(screen.getByText('23 Okt – 24 Nov')).toBeTruthy();
  });

  it('dibuka dari baris Belum dianggarkan: kategori terisi dan keterangan periode lalu tampil', async () => {
    setup({ categoryId: 'k-internet' });
    await screen.findByRole('dialog');
    expect(category()).toHaveValue('k-internet');
    expect(screen.getByText(/Periode lalu: Rp 350\.000/)).toBeTruthy();
  });

  it('kategori kosong: galat di bawah Kategori, fokus ke Kategori, tidak mengirim', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await user.click(save());
    const msg = screen.getByText('Pilih kategori pengeluaran.');
    expect(category()).toHaveAttribute('aria-invalid', 'true');
    expect(category().getAttribute('aria-describedby')).toContain(msg.id);
    expect(category()).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('nominal kosong atau nol: galat di bawah Nominal, fokus ke Nominal', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ categoryId: 'k-internet' });
    await user.click(save());
    expect(screen.getByText('Nominal harus lebih dari nol.')).toBeTruthy();
    expect(amount()).toHaveFocus();
    await user.type(amount(), '0');
    await user.click(save());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('simpan: mengirim kategori, nominal, wajib; toast menyebut ruang tanpa nominal; sheet menutup', async () => {
    const user = userEvent.setup();
    const { onSubmit, onOpenChange } = setup({ categoryId: 'k-internet' });
    await user.type(await screen.findByRole('textbox', { name: 'Anggaran periode ini' }), '350000');
    await user.click(wajib());
    expect(wajib()).toHaveAttribute('aria-checked', 'true');
    await user.click(save());
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        categoryId: 'k-internet',
        amount: 350_000,
        wajib: true,
      });
    });
    expect(toastSpy).toHaveBeenCalledWith({ message: 'Anggaran Internet disimpan · Pribadi' });
    expect(JSON.stringify(toastSpy.mock.calls.at(-1))).not.toContain('350');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('semua kategori sudah dianggarkan: pilihan memberi tahu, Simpan tidak mengirim', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ rows: ROWS.filter((r) => r.budget !== null && !r.archived) });
    await screen.findByRole('dialog');
    expect(category()).toBeDisabled();
    expect(
      screen.getByRole('option', { name: 'Semua kategori sudah punya anggaran.' }),
    ).toBeTruthy();
    await user.click(save());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('BudgetSheet: galat server', () => {
  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByRole('textbox', { name: 'Anggaran periode ini' }), '100000');
    await user.click(save());
  }

  it('obligation_double: salinan dengan nama tagihan di bawah sakelar Wajib, fokus ke sakelar, tanpa nominal', async () => {
    const user = userEvent.setup();
    setup({ categoryId: 'k-listrik' }, { ok: false, code: 'obligation_double' });
    await fill(user);
    const msg = await screen.findByText(
      'Kategori ini sudah punya tagihan Listrik PLN. Satu kewajiban cukup dicatat sekali: arsipkan tagihannya atau jadikan anggaran ini tidak wajib.',
    );
    expect(msg.id).not.toBe('');
    expect(wajib().getAttribute('aria-describedby')?.split(' ')).toContain(msg.id);
    expect(wajib()).toHaveAttribute('aria-invalid', 'true');
    expect(wajib()).toHaveFocus();
    expect(msg.textContent).not.toMatch(/\d{3}/);
  });

  it('obligation_double tanpa tagihan yang dikenal: kalimat tanpa nama', async () => {
    const user = userEvent.setup();
    setup({ categoryId: 'k-internet' }, { ok: false, code: 'obligation_double' });
    await fill(user);
    expect(await screen.findByText(/^Kategori ini sudah punya tagihan\. /)).toBeTruthy();
  });

  it('category_not_root: galat di Kategori, fokus ke Kategori', async () => {
    const user = userEvent.setup();
    setup({ categoryId: 'k-internet' }, { ok: false, code: 'category_not_root' });
    await fill(user);
    expect(
      await screen.findByText(
        'Kategori ini sudah bukan kategori induk. Tutup lalu buka Rencana lagi.',
      ),
    ).toBeTruthy();
    expect(category()).toHaveFocus();
  });

  it('category_archived: salinan memakai nama kategori', async () => {
    const user = userEvent.setup();
    setup({ categoryId: 'k-internet' }, { ok: false, code: 'category_archived' });
    await fill(user);
    expect(await screen.findByText('Internet sudah diarsipkan. Pilih kategori lain.')).toBeTruthy();
  });

  it('invalid pada amount: galat di Nominal', async () => {
    const user = userEvent.setup();
    setup({ categoryId: 'k-internet' }, { ok: false, code: 'invalid', field: 'amount' });
    await fill(user);
    expect(await screen.findByText('Nominal harus lebih dari nol.')).toBeTruthy();
    expect(amount()).toHaveFocus();
  });

  it('jaringan: kotak peringatan + Coba lagi mengirim ulang isian yang sama', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ categoryId: 'k-internet' }, { ok: false, code: 'network' });
    await fill(user);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Coba lagi tidak akan mencatat dua kali.');
    await user.click(within(alert).getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(2);
    });
    expect(onSubmit.mock.calls[1]?.[0]).toEqual(onSubmit.mock.calls[0]?.[0]);
  });

  it('Server Action yang melempar dianggap jaringan', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ categoryId: 'k-internet' });
    onSubmit.mockRejectedValueOnce(new Error('putus'));
    await fill(user);
    expect((await screen.findByRole('alert')).textContent).toContain('Koneksi terputus');
  });
});

describe('BudgetSheet: a11y sakelar dan galat (M2, M3, D5, D6)', () => {
  it('sakelar Wajib selalu merujuk petunjuk; Ya memakai ikon centang selain teks', async () => {
    const user = userEvent.setup();
    setup({ categoryId: 'k-internet' });
    await screen.findByRole('dialog');
    const hint = screen.getByText('Dipotong dari aman dipakai sampai terpakai.');
    expect(wajib().getAttribute('aria-describedby')).toBe(hint.id);
    expect(wajib().querySelector('svg')).toBeNull();
    await user.click(wajib());
    expect(wajib().querySelector('svg')).toBeTruthy();
    expect(wajib()).toHaveTextContent('Ya');
  });

  it('galat kolom memakai role=alert dan memindahkan fokus ke kolom yang salah', async () => {
    const user = userEvent.setup();
    setup({ categoryId: 'k-internet' });
    await user.click(await screen.findByRole('button', { name: 'Simpan anggaran' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Nominal harus lebih dari nol.');
    expect(amount()).toHaveFocus();
  });

  it('invalid pada month: kotak galat umum, bukan "Pilih kategori"', async () => {
    const user = userEvent.setup();
    setup({ categoryId: 'k-internet' }, { ok: false, code: 'invalid', field: 'month' });
    await user.type(await screen.findByRole('textbox', { name: 'Anggaran periode ini' }), '100');
    await user.click(save());
    expect(await screen.findByText('Isian belum lengkap. Periksa lagi lalu simpan.')).toBeTruthy();
    expect(screen.queryByText('Pilih kategori pengeluaran.')).toBeNull();
  });

  it('semua kategori sudah dianggarkan: fokus awal tidak ke select yang nonaktif', async () => {
    setup({ rows: ROWS.filter((r) => r.budget !== null && !r.archived) });
    await screen.findByRole('dialog');
    expect(category()).not.toHaveFocus();
    expect(amount()).toHaveFocus();
  });
});

describe('BudgetSheet: ubah dan hapus', () => {
  it('ubah: kategori terkunci sebagai teks, nominal dan Wajib terisi, fokus awal di Nominal', async () => {
    setup({ categoryId: 'k-sewa' });
    await screen.findByRole('dialog');
    expect(screen.queryByRole('combobox', { name: 'Kategori' })).toBeNull();
    expect(screen.getByText('Sewa Rumah')).toBeTruthy();
    expect(amount()).toHaveValue('2.500.000');
    expect(wajib()).toHaveAttribute('aria-checked', 'true');
    expect(amount()).toHaveFocus();
  });

  it('Hapus anggaran membuka dialog dengan fokus awal Kembali; konfirmasi menghapus lalu toast', async () => {
    const user = userEvent.setup();
    const { onDelete, onOpenChange } = setup({ categoryId: 'k-sewa' });
    await user.click(await screen.findByRole('button', { name: 'Hapus anggaran' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Hapus anggaran Sewa Rumah?' });
    expect(
      within(dialog).getByText(
        'Pengeluaran kategori ini tetap tercatat. Hanya batasnya yang dihapus.',
      ),
    ).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Kembali' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Hapus anggaran' }));
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('k-sewa');
    });
    expect(toastSpy).toHaveBeenCalledWith({ message: 'Anggaran Sewa Rumah dihapus · Pribadi' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('hapus gagal: galat di dalam dialog, dialog tetap terbuka', async () => {
    const user = userEvent.setup();
    const { onDelete, onOpenChange } = setup({ categoryId: 'k-sewa' });
    onDelete.mockResolvedValueOnce({ ok: false, code: 'network' });
    await user.click(await screen.findByRole('button', { name: 'Hapus anggaran' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Hapus anggaran' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Belum terhapus. Koneksi terputus',
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('kategori terarsip: hanya Hapus yang ditawarkan (tanpa Simpan, nominal terkunci)', async () => {
    setup({ categoryId: 'k-lama' });
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Simpan anggaran' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Hapus anggaran' })).toBeTruthy();
    expect(
      screen.getByText('Kategori ini sudah diarsipkan. Anggarannya masih bisa dihapus.'),
    ).toBeTruthy();
    expect(amount()).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('BudgetSheet: Bersama', () => {
  it('judul memuat Bersama; toast menyebut Bersama', async () => {
    const user = userEvent.setup();
    setup({ ruang: 'bersama', categoryId: 'k-internet' });
    expect(await screen.findByRole('dialog', { name: /^Anggaran\s*Bersama$/ })).toBeTruthy();
    await user.type(amount(), '1000');
    await user.click(save());
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith({ message: 'Anggaran Internet disimpan · Bersama' });
    });
  });
});
