import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatRupiah } from '@dompetku/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountVM, ActionResult, CategoryVM, EntryVM } from '@/features/ledger/types';
import { MoveSheet, moveFailedText, type MoveSource, type MoveTargetsData } from './move-sheet';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({ toast }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ENTRY: EntryVM = {
  id: 'e1',
  version: 3,
  kind: 'expense',
  occurredOn: '2026-11-02',
  createdAt: '2026-11-02T08:00:00+07:00',
  createdBy: { id: 'u-n', name: 'Novanda', initial: 'N' },
  accountId: 'p-bca',
  accountName: 'BCA',
  amount: 150_000,
  categoryId: 'p-makan',
  categoryName: 'Makan',
  description: 'Makan siang tim',
};

const acc = (id: string, name: string): AccountVM => ({
  id,
  name,
  pocket: 'operasional',
  walletType: 'bank',
  openedOn: '2026-10-01',
  archived: false,
  balance: 1_000_000,
});
const cat = (id: string, name: string, over: Partial<CategoryVM> = {}): CategoryVM => ({
  id,
  parentId: null,
  name,
  type: 'expense',
  icon: 'tag',
  archived: false,
  ...over,
});

const TARGETS: MoveTargetsData = {
  accounts: [acc('b-kas', 'Kas Bersama'), acc('b-bca', 'bca ')],
  categories: [
    cat('b-listrik', 'Listrik'),
    cat('b-makan', 'Makan'),
    cat('b-gaji', 'Gaji', { type: 'income' }),
    cat('b-lama', 'Lama', { archived: true }),
  ],
};

function setup(
  over: {
    entry?: Partial<EntryVM>;
    ruang?: 'pribadi' | 'bersama';
    toRuang?: 'pribadi' | 'bersama';
    targets?: ActionResult<MoveTargetsData>;
    move?: ActionResult<unknown>;
  } = {},
) {
  const targets = vi.fn<MoveSource['targets']>(() =>
    Promise.resolve(over.targets ?? { ok: true, value: TARGETS }),
  );
  const move = vi.fn<MoveSource['move']>(() =>
    Promise.resolve(over.move ?? { ok: true, value: {} }),
  );
  const source: MoveSource = { targets, move };
  const onMoved = vi.fn();
  const onOpenChange = vi.fn();
  const onConflict = vi.fn();
  render(
    <MoveSheet
      open
      onOpenChange={onOpenChange}
      ruang={over.ruang ?? 'pribadi'}
      toRuang={over.toRuang ?? 'bersama'}
      entry={{ ...ENTRY, ...over.entry }}
      source={source}
      onMoved={onMoved}
      onConflict={onConflict}
    />,
  );
  return { source, targets, move, onMoved, onOpenChange, onConflict };
}

const next = () => screen.getByRole('button', { name: 'Lanjut' });

describe('MoveSheet (S7-D2)', () => {
  it('memuat pilihan ruang tujuan saat dibuka (lewat source), judul dan ringkasan entri', async () => {
    const { targets } = setup();
    expect(await screen.findByRole('dialog', { name: 'Pindahkan ke Bersama' })).toBeTruthy();
    expect(targets).toHaveBeenCalledWith('bersama');
    expect(await screen.findByLabelText('Dompet di Bersama')).toBeTruthy();
    expect(screen.getByText('Makan siang tim')).toBeTruthy();
    expect(screen.getByText(/Dari/)).toBeTruthy();
  });

  it('dompet dan kategori terpilih otomatis bila ada nama sama (tanpa huruf besar/spasi); Kategori hanya jenis entri aktif', async () => {
    setup();
    const select = await screen.findByLabelText<HTMLSelectElement>('Dompet di Bersama');
    expect(select.value).toBe('b-bca');
    const chips = screen.getAllByRole('radio');
    expect(chips.map((c) => c.textContent)).toEqual(['Makan', 'Listrik']);
    expect(chips[0]?.getAttribute('aria-checked')).toBe('true');
    expect(next().getAttribute('aria-disabled')).toBeNull();
  });

  it('tanpa padanan: sumber kosong, Lanjut nonaktif dengan petunjuk sampai dompet dan kategori dipilih', async () => {
    const user = userEvent.setup();
    setup({
      entry: { accountName: 'Dompet Lain', categoryName: 'Lain-lain' },
    });
    const select = await screen.findByLabelText<HTMLSelectElement>('Dompet di Bersama');
    expect(select.value).toBe('');
    expect(next().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Pilih dompet dan kategori untuk melanjutkan')).toBeTruthy();
    await user.selectOptions(select, 'b-kas');
    expect(next().getAttribute('aria-disabled')).toBe('true');
    await user.click(screen.getByRole('radio', { name: 'Listrik' }));
    expect(next().getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText('Pilih dompet dan kategori untuk melanjutkan')).toBeNull();
  });

  it('Pribadi → Bersama berketerangan: Bawa keterangan (bawaan mati) + dialog akibat + kirim keepDescription=false', async () => {
    const user = userEvent.setup();
    const { move, onMoved, onOpenChange } = setup();
    await screen.findByLabelText('Dompet di Bersama');
    const keep = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Bawa keterangan' });
    expect(keep.checked).toBe(false);
    expect(keep.getAttribute('aria-describedby')).toBeTruthy();
    expect(
      screen.getByText(
        /Bila dicentang, keterangan ikut dipindah dan terlihat oleh anggota Bersama/,
      ),
    ).toBeTruthy();
    // Isi keterangan tidak dikutip di penjelasan.
    expect(document.body.textContent).not.toMatch(/Bila dicentang[^.]*Makan siang tim/);

    await user.click(next());
    const dialog = await screen.findByRole('alertdialog', { name: 'Pindahkan ke Bersama?' });
    const items = within(dialog)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual([
      'Transaksi ini dibatalkan di Pribadi dan dibuat ulang di Bersama.',
      'Saldo BCA dan bca  ikut berubah.',
      'Yang sudah dipindah tidak bisa dipulihkan dari Sampah Pribadi.',
      'Keterangan tidak ikut dipindah.',
    ]);
    // Fokus awal di Kembali (tombol aman).
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Kembali' }));

    await user.click(within(dialog).getByRole('button', { name: 'Pindahkan' }));
    await waitFor(() => {
      expect(move).toHaveBeenCalledTimes(1);
    });
    expect(move.mock.calls[0]?.[0]).toEqual({
      clientId: expect.stringMatching(UUID_V4) as unknown,
      entryId: 'e1',
      expectedVersion: 3,
      toRuang: 'bersama',
      accountId: 'b-bca',
      categoryId: 'b-makan',
      keepDescription: false,
    });
    await waitFor(() => {
      expect(onMoved).toHaveBeenCalledTimes(1);
    });
    expect(toast).toHaveBeenCalledWith({
      message: `Dipindahkan ke Bersama · ${formatRupiah(150_000)}`,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('dicentang: keterangan ikut (butir dialog + keepDescription=true)', async () => {
    const user = userEvent.setup();
    const { move } = setup();
    await screen.findByLabelText('Dompet di Bersama');
    await user.click(screen.getByRole('checkbox', { name: 'Bawa keterangan' }));
    await user.click(next());
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Keterangan ikut dipindah.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Pindahkan' }));
    await waitFor(() => {
      expect(move).toHaveBeenCalled();
    });
    expect(move.mock.calls[0]?.[0]).toMatchObject({ keepDescription: true });
  });

  it('Pribadi → Bersama tanpa keterangan, dan Bersama → Pribadi: tanpa kontrol Bawa keterangan (R13)', async () => {
    setup({ entry: { description: undefined as never } });
    await screen.findByLabelText('Dompet di Bersama');
    expect(screen.queryByRole('checkbox')).toBeNull();
    cleanup();
    setup({ ruang: 'bersama', toRuang: 'pribadi' });
    await screen.findByLabelText('Dompet di Pribadi');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('gagal: dialog tetap terbuka dengan pesan (tanpa nominal), fokus ke Kembali; Coba lagi memakai clientId sama', async () => {
    const user = userEvent.setup();
    const { move, onMoved } = setup({ move: { ok: false, error: { code: 'network' } } });
    await screen.findByLabelText('Dompet di Bersama');
    await user.click(next());
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Pindahkan' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe(moveFailedText('network', 'Bersama'));
    expect(alert.textContent).not.toMatch(/Rp/);
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Kembali' }));
    expect(onMoved).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => {
      expect(move).toHaveBeenCalledTimes(2);
    });
    const ids = move.mock.calls.map((c) => c[0].clientId);
    expect(ids[0]).toBe(ids[1]);
  });

  it('konflik versi: onConflict + pesan; data ruang tujuan gagal dimuat: pesan + Coba lagi', async () => {
    const user = userEvent.setup();
    const { onConflict } = setup({ move: { ok: false, error: { code: 'conflict' } } });
    await screen.findByLabelText('Dompet di Bersama');
    await user.click(next());
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Pindahkan' }));
    await waitFor(() => {
      expect(onConflict).toHaveBeenCalledTimes(1);
    });
    cleanup();
    setup({ targets: { ok: false, error: { code: 'network' } } });
    expect(await screen.findByText(/Belum bisa memuat pilihan di ruang tujuan/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
  });

  it('fokus awal ke Select Dompet sesudah data termuat; saldo_negatif netral tanpa nominal', async () => {
    setup();
    const select = await screen.findByLabelText<HTMLSelectElement>('Dompet di Bersama');
    await waitFor(() => {
      expect(document.activeElement).toBe(select);
    });
    expect(moveFailedText('saldo_negatif', 'Bersama')).toBe(
      'Saldo dompet asal atau tujuan jadi kurang dari nol. Periksa saldonya dulu.',
    );
  });

  it('salinan galat tabel S7: entry_moved, kind_not_movable, not_creator', () => {
    expect(moveFailedText('entry_moved', 'Bersama')).toBe(
      'Transaksi ini sudah dipindahkan ke Bersama.',
    );
    expect(moveFailedText('kind_not_movable', 'Bersama')).toBe(
      'Jenis transaksi ini tidak bisa dipindahkan ke ruang lain.',
    );
    expect(moveFailedText('not_creator', 'Bersama')).toBe(
      'Hanya pencatat yang bisa membatalkan, memulihkan, atau memindahkan transaksi ini.',
    );
  });
});
