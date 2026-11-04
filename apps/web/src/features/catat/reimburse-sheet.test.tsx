import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatRupiah } from '@dompetku/domain';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AccountVM, EntryVM } from '@/features/ledger/types';
import {
  NotReimbursedDialog,
  ReimburseSheet,
  reimburseFailedText,
  type ReimburseSource,
} from './reimburse-sheet';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({ toast }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const TODAY = '2026-11-04';

const TALANGAN: EntryVM = {
  id: 't1',
  version: 4,
  kind: 'expense',
  occurredOn: '2026-11-01',
  createdAt: '2026-11-01T08:00:00+07:00',
  createdBy: { id: 'u-n', name: 'Novanda', initial: 'N' },
  accountId: 'a-mandiri',
  accountName: 'Mandiri',
  amount: 500_000,
  categoryId: 'c-perjalanan',
  categoryName: 'Perjalanan',
  description: 'Tiket dinas',
  reimbursable: true,
};

const acc = (id: string, name: string, pocket: AccountVM['pocket'] = 'operasional'): AccountVM => ({
  id,
  name,
  pocket,
  walletType: 'bank',
  openedOn: '2026-10-01',
  archived: false,
  balance: 1_000_000,
});
const ACCOUNTS = [
  acc('a-bca', 'BCA'),
  acc('a-mandiri', 'Mandiri'),
  acc('a-kantor', 'Kas Kantor', 'kantor'),
];

interface Kit {
  src: ReimburseSource;
  create: Mock<ReimburseSource['create']>;
  undo: Mock<ReimburseSource['undo']>;
  notReimbursed: Mock<ReimburseSource['notReimbursed']>;
}

function source(
  over: {
    create?: Awaited<ReturnType<ReimburseSource['create']>>;
    notReimbursed?: Awaited<ReturnType<ReimburseSource['notReimbursed']>>;
  } = {},
): Kit {
  const create = vi.fn<ReimburseSource['create']>(() =>
    Promise.resolve(over.create ?? { ok: true, value: { entryId: 'r-baru' } }),
  );
  const undo = vi.fn<ReimburseSource['undo']>(() => Promise.resolve(true));
  const notReimbursed = vi.fn<ReimburseSource['notReimbursed']>(() =>
    Promise.resolve(over.notReimbursed ?? { ok: true, value: {} }),
  );
  return { src: { create, undo, notReimbursed }, create, undo, notReimbursed };
}

function renderSheet(kit: Kit, remaining = 200_000) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <ReimburseSheet
      open
      onOpenChange={onOpenChange}
      entry={TALANGAN}
      remaining={remaining}
      accounts={ACCOUNTS}
      today={TODAY}
      source={kit.src}
      onSaved={onSaved}
    />,
  );
  return { onOpenChange, onSaved };
}

describe('ReimburseSheet (S7-D3)', () => {
  it('judul Pribadi; nominal default = sisa; dompet default = dompet talangan tanpa Kantor; tanggal hari ini', async () => {
    renderSheet(source());
    expect(
      await screen.findByRole('dialog', { name: 'Reimburse talangan · Pribadi' }),
    ).toBeTruthy();
    const amount = screen.getByRole('textbox', { name: 'Jumlah diganti' });
    expect(amount).toHaveProperty('value', '200.000');
    expect(document.activeElement).toBe(amount);
    const wallet = screen.getByLabelText<HTMLSelectElement>('Ke dompet');
    expect(wallet.value).toBe('a-mandiri');
    expect(Array.from(wallet.options).map((o) => o.text)).toEqual(['BCA', 'Mandiri']);
    const date = screen.getByLabelText<HTMLSelectElement>('Tanggal');
    expect(date.value).toBe(TODAY);
    // Tidak ada tanggal sebelum tanggal talangan.
    expect(Array.from(date.options).every((o) => o.value >= TALANGAN.occurredOn)).toBe(true);
  });

  it('simpan: kirim nominal/dompet/tanggal, toast dengan Urungkan, tutup, onSaved', async () => {
    const user = userEvent.setup();
    const kit = source();
    const { onOpenChange, onSaved } = renderSheet(kit);
    const amount = screen.getByRole('textbox', { name: 'Jumlah diganti' });
    await user.clear(amount);
    await user.type(amount, '120000');
    await user.click(screen.getByRole('button', { name: 'Simpan reimburse' }));
    await waitFor(() => {
      expect(kit.create).toHaveBeenCalledTimes(1);
    });
    expect(kit.create.mock.calls[0]?.[0]).toMatchObject({
      entryId: 't1',
      accountId: 'a-mandiri',
      amount: 120_000,
      occurredOn: TODAY,
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    const arg = toast.mock.calls[0]?.[0] as {
      message: string;
      action: { label: string; onAction: () => void };
    };
    expect(arg.message).toBe(`Reimburse tersimpan di Pribadi · ${formatRupiah(120_000)}`);
    expect(arg.action.label).toBe('Urungkan');
    arg.action.onAction();
    await waitFor(() => {
      expect(kit.undo).toHaveBeenCalledWith('r-baru');
    });
  });

  it('nominal kosong: Simpan nonaktif', async () => {
    const user = userEvent.setup();
    const kit = source();
    renderSheet(kit);
    await user.clear(screen.getByRole('textbox', { name: 'Jumlah diganti' }));
    const save = screen.getByRole('button', { name: 'Simpan reimburse' });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    await user.click(save);
    expect(kit.create).not.toHaveBeenCalled();
  });

  it('reimbursement_exceeds: galat di bawah kolom (tanpa nominal), fokus ke kolom, bukan kotak alert', async () => {
    const user = userEvent.setup();
    const kit = source({ create: { ok: false, error: { code: 'reimbursement_exceeds' } } });
    renderSheet(kit);
    await user.click(screen.getByRole('button', { name: 'Simpan reimburse' }));
    const text = await screen.findByText(
      'Jumlah ini lebih besar dari sisa yang belum diganti. Kurangi jumlahnya.',
    );
    expect(text.closest('[role="alert"]')).toBeNull();
    expect(
      screen.getByRole('textbox', { name: 'Jumlah diganti' }).getAttribute('aria-describedby'),
    ).toBe(text.closest('p')?.id);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Jumlah diganti' }));
  });

  it('galat lain: kotak alert; jaringan: Coba lagi memakai clientId sama', async () => {
    const user = userEvent.setup();
    const kit = source({ create: { ok: false, error: { code: 'network' } } });
    const { create } = kit;
    renderSheet(kit);
    await user.click(screen.getByRole('button', { name: 'Simpan reimburse' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Coba lagi tidak akan mencatat dua kali');
    await user.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(2);
    });
    expect(create.mock.calls[0]?.[0].clientId).toBe(create.mock.calls[1]?.[0].clientId);
    expect(reimburseFailedText('not_reimbursable', 'X')).toBe(
      'Transaksi ini bukan talangan yang menunggu diganti. Muat ulang halaman.',
    );
    expect(reimburseFailedText('reimbursement_exists', 'X')).toBe(
      'Talangan ini sudah punya reimburse. Batalkan reimburse itu dulu.',
    );
  });
});

describe('NotReimbursedDialog (S7-D3)', () => {
  function renderDialog(kit: Kit) {
    const onOpenChange = vi.fn();
    const onDone = vi.fn();
    render(
      <NotReimbursedDialog
        open
        onOpenChange={onOpenChange}
        entry={TALANGAN}
        source={kit.src}
        onDone={onDone}
      />,
    );
    return { onOpenChange, onDone };
  }

  it('salinan tetap; fokus awal di Kembali; konfirmasi → notReimbursed, toast, tutup', async () => {
    const user = userEvent.setup();
    const kit = source();
    const { onOpenChange, onDone } = renderDialog(kit);
    const dialog = await screen.findByRole('alertdialog', { name: 'Tandai tidak diganti?' });
    expect(
      within(dialog).getByText(
        /Pengeluaran ini jadi pengeluaran pribadi biasa dan masuk hitungan Pribadi\./,
      ),
    ).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Kembali' }));
    await user.click(within(dialog).getByRole('button', { name: 'Tandai tidak diganti' }));
    await waitFor(() => {
      expect(kit.notReimbursed).toHaveBeenCalledTimes(1);
    });
    expect(kit.notReimbursed.mock.calls[0]?.[0].entry.id).toBe('t1');
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast).toHaveBeenCalledWith({ message: 'Ditandai tidak diganti di Pribadi' });
  });

  it('reimbursement_exists: dialog tetap terbuka dengan pesan tabel galat', async () => {
    const user = userEvent.setup();
    const kit = source({
      notReimbursed: { ok: false, error: { code: 'reimbursement_exists' } },
    });
    const { onDone } = renderDialog(kit);
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Tandai tidak diganti' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe(
      'Talangan ini sudah punya reimburse. Batalkan reimburse itu dulu.',
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
});

describe('NotReimbursedDialog konflik', () => {
  it('conflict memanggil onConflict', async () => {
    const user = userEvent.setup();
    const kit = source({ notReimbursed: { ok: false, error: { code: 'conflict' } } });
    const onConflict = vi.fn();
    render(
      <NotReimbursedDialog
        open
        onOpenChange={vi.fn()}
        entry={TALANGAN}
        source={kit.src}
        onConflict={onConflict}
      />,
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Tandai tidak diganti' }));
    await waitFor(() => {
      expect(onConflict).toHaveBeenCalledTimes(1);
    });
  });
});
