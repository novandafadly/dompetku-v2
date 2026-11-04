import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AccountVM,
  ActionResult,
  EntryVM,
  LedgerErrorCode,
  TrashVM,
} from '@/features/ledger/types';
import { TrashList } from './trash-parts';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({ toast }));

const TODAY = '2026-11-02';

function entry(id: string, over: Partial<EntryVM> = {}): EntryVM {
  return {
    id,
    version: 3,
    kind: 'expense',
    occurredOn: '2026-11-01',
    createdAt: '2026-11-01T08:00:00+07:00',
    createdBy: { id: 'u', name: 'Novanda', initial: 'N' },
    accountId: 'acc-1',
    accountName: 'BCA',
    amount: 25_000,
    categoryName: 'Makan',
    description: 'Nasi padang',
    voidedAt: '2026-11-02T09:00:00+07:00',
    ...over,
  };
}

const item = (id: string, over: Partial<EntryVM> = {}): TrashVM => ({
  entry: entry(id, over),
  purgeAfter: '2027-01-31T09:00:00+07:00',
});

const ACCOUNT: AccountVM = {
  id: 'acc-1',
  name: 'BCA',
  pocket: 'operasional',
  walletType: 'bank',
  openedOn: '2026-10-01',
  archived: false,
  balance: 10_000,
};

type Restore = (r: {
  clientId: string;
  entryId: string;
  expectedVersion: number;
  allowNegative: boolean;
}) => Promise<ActionResult<{ version: number }>>;

const ok: ActionResult<{ version: number }> = { ok: true, value: { version: 4 } };
const fail = (code: LedgerErrorCode) => ({ ok: false, error: { code } }) as const;

function view(
  items: TrashVM[],
  restore: Restore,
  extra: { onConflict?: () => void; restoreLockedIds?: string[] } = {},
) {
  return render(
    <>
      <h1 id="sampah-judul">Sampah · Pribadi</h1>
      <TrashList
        ruang="pribadi"
        today={TODAY}
        items={items}
        accounts={[ACCOUNT]}
        restore={restore}
        {...extra}
      />
    </>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('TrashList (daftar Sampah + Pulihkan)', () => {
  it('baris: keterangan, meta dengan hari batal, Terhapus permanen, nominal; bukan tautan', () => {
    view(
      [item('e1'), item('e2', { description: 'Kopi', voidedAt: '2026-11-01T09:00:00+07:00' })],
      vi.fn(),
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const first = rows[0];
    if (!first) throw new Error('baris');
    expect(first).toHaveTextContent('Nasi padang');
    expect(first).toHaveTextContent('Makan · BCA · Dibatalkan Hari ini');
    expect(first).toHaveTextContent('Terhapus permanen Min, 31 Jan 2027');
    expect(first).toHaveTextContent(/25\.000/);
    expect(within(first).queryByRole('link')).toBeNull();
    expect(rows[1]).toHaveTextContent('Dibatalkan Kemarin');
    const btn = within(first).getByRole('button', { name: /^Pulihkan Nasi padang/ });
    expect(btn.getAttribute('aria-label')).toMatch(/^Pulihkan Nasi padang .*25\.000$/);
    expect(btn).toHaveTextContent('Pulihkan');
    expect(btn.className).toContain('min-h-11');
  });

  it('restoreLockedIds: baris tanpa tombol Pulihkan, teks "Hanya {Nama} yang bisa memulihkan."', () => {
    const restore = vi.fn<Restore>();
    view(
      [
        item('s1', {
          kind: 'space_transfer',
          direction: 'in',
          createdBy: { id: 'f', name: 'Farida', initial: 'F' },
        }),
        item('e2'),
      ],
      restore,
      { restoreLockedIds: ['s1'] },
    );
    expect(screen.getByText('Hanya Farida yang bisa memulihkan.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Pulihkan/ })).toHaveLength(1);
    expect(restore).not.toHaveBeenCalled();
  });

  it('Pulihkan reimburse ditolak not_reimbursable: salinan sendiri (role=alert)', async () => {
    view([item('r1', { kind: 'reimbursement' })], () => Promise.resolve(fail('not_reimbursable')));
    fireEvent.click(screen.getByRole('button', { name: /^Pulihkan/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Belum bisa dipulihkan. Talangannya tidak lagi menunggu diganti.',
    );
  });

  it('daftar kosong: salinan S6-S1', () => {
    view([], vi.fn());
    expect(
      screen.getByText(
        'Sampah kosong. Transaksi yang dibatalkan bisa dipulihkan di sini selama 90 hari.',
      ),
    ).toBeTruthy();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('Pulihkan: mengirim id, versi, clientId UUID dan toast menyebut ruang', async () => {
    const restore = vi.fn<Restore>().mockResolvedValue(ok);
    view([item('e1')], restore);
    fireEvent.click(screen.getByRole('button', { name: /^Pulihkan/ }));
    await waitFor(() => {
      expect(toast).toHaveBeenCalled();
    });
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore.mock.calls[0]?.[0]).toMatchObject({
      entryId: 'e1',
      expectedVersion: 3,
      allowNegative: false,
    });
    expect(restore.mock.calls[0]?.[0].clientId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const shown = toast.mock.calls[0]?.[0] as { message: string };
    expect(shown.message).toMatch(/^Dipulihkan di Pribadi · Rp\s25\.000$/);
  });

  it('klik ganda saat sibuk = satu permintaan', async () => {
    let done: (r: ActionResult<{ version: number }>) => void = () => undefined;
    const restore = vi.fn<Restore>(
      () =>
        new Promise((res) => {
          done = res;
        }),
    );
    view([item('e1')], restore);
    const btn = screen.getByRole('button', { name: /^Pulihkan/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      done(ok);
      await Promise.resolve();
    });
  });

  it('restore_window_closed: teks lewat 90 hari sebaris, baris tetap, tombol hilang', async () => {
    view(
      [item('e1'), item('e2', { description: 'Kopi' })],
      vi.fn<Restore>().mockResolvedValue(fail('restore_window_closed')),
    );
    const first = screen.getAllByRole('listitem')[0];
    if (!first) throw new Error('baris');
    fireEvent.click(within(first).getByRole('button', { name: /^Pulihkan/ }));
    expect(
      await within(first).findByText('Lewat 90 hari, transaksi ini tidak bisa dipulihkan lagi.'),
    ).toBeTruthy();
    expect(within(first).queryByRole('button')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(toast).not.toHaveBeenCalled();
  });

  it('restore_window_closed: fokus pindah ke teks lewat 90 hari, bukan ke body', async () => {
    view([item('e1')], vi.fn<Restore>().mockResolvedValue(fail('restore_window_closed')));
    const btn = screen.getByRole('button', { name: /^Pulihkan/ });
    btn.focus();
    fireEvent.click(btn);
    const text = await screen.findByText(
      'Lewat 90 hari, transaksi ini tidak bisa dipulihkan lagi.',
    );
    await waitFor(() => {
      expect(text.closest('p')).toHaveFocus();
    });
  });

  it.each([
    ['account_archived', 'Belum bisa dipulihkan. Dompetnya sudah diarsipkan.'],
    ['idem_mismatch', 'Belum bisa dipulihkan. Ada kendala di server.'],
    ['not_found', 'Belum bisa dipulihkan. Ada kendala di server.'],
    ['unknown', 'Belum bisa dipulihkan. Ada kendala di server.'],
  ] as const)('galat %s: pesan role=alert tidak menyalahkan koneksi', async (code, text) => {
    view([item('e1')], vi.fn<Restore>().mockResolvedValue(fail(code)));
    fireEvent.click(screen.getByRole('button', { name: /^Pulihkan/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('berhasil tetapi daftar belum dimuat ulang (refresh gagal): tombol tidak tertahan sibuk', async () => {
    view([item('e1')], vi.fn<Restore>().mockResolvedValue(ok));
    fireEvent.click(screen.getByRole('button', { name: /^Pulihkan/ }));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Pulihkan/ })).not.toHaveAttribute('aria-busy');
    });
    expect(screen.getByRole('button', { name: /^Pulihkan/ })).not.toHaveAttribute('aria-disabled');
  });

  it('saldo_negatif: peringatan S6-C3 lalu Tetap pulihkan memakai clientId yang sama', async () => {
    const restore = vi
      .fn<Restore>()
      .mockResolvedValueOnce(fail('saldo_negatif'))
      .mockResolvedValueOnce(ok);
    view([item('e1')], restore);
    fireEvent.click(screen.getByRole('button', { name: /^Pulihkan/ }));
    expect(await screen.findByText(/^Saldo BCA tinggal Rp\s10\.000\./)).toHaveTextContent(
      /Kalau dipulihkan, saldonya jadi (−|-)Rp\s15\.000\.$/,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Tetap pulihkan Nasi padang/ }));
    await waitFor(() => {
      expect(restore).toHaveBeenCalledTimes(2);
    });
    expect(restore.mock.calls[1]?.[0]).toMatchObject({ allowNegative: true });
    expect(restore.mock.calls[1]?.[0].clientId).toBe(restore.mock.calls[0]?.[0].clientId);
  });

  it('galat jaringan: pesan role=alert, Coba lagi lewat tombol yang sama', async () => {
    const restore = vi
      .fn<Restore>()
      .mockRejectedValueOnce(new Error('putus'))
      .mockResolvedValueOnce(ok);
    view([item('e1')], restore);
    fireEvent.click(screen.getByRole('button', { name: /^Pulihkan/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Belum bisa dipulihkan. Periksa koneksi lalu coba lagi.',
    );
    fireEvent.click(screen.getByRole('button', { name: /^Pulihkan/ }));
    await waitFor(() => {
      expect(toast).toHaveBeenCalled();
    });
  });

  it('konflik versi: onConflict (muat ulang), clientId baru, tombol aktif lagi', async () => {
    const onConflict = vi.fn();
    const restore = vi.fn<Restore>().mockResolvedValue(fail('conflict'));
    view([item('e1')], restore, { onConflict });
    fireEvent.click(screen.getByRole('button', { name: /^Pulihkan/ }));
    await waitFor(() => {
      expect(onConflict).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByRole('button', { name: /^Pulihkan/ }));
    await waitFor(() => {
      expect(restore).toHaveBeenCalledTimes(2);
    });
    expect(restore.mock.calls[1]?.[0].clientId).not.toBe(restore.mock.calls[0]?.[0].clientId);
  });

  it('sesudah pulih, fokus ke Pulihkan baris berikutnya; daftar habis = ke judul halaman', async () => {
    const restore = vi.fn<Restore>().mockResolvedValue(ok);
    const { rerender } = view([item('e1'), item('e2', { description: 'Kopi' })], restore);
    const props = (items: TrashVM[]) => (
      <>
        <h1 id="sampah-judul">Sampah · Pribadi</h1>
        <TrashList
          ruang="pribadi"
          today={TODAY}
          items={items}
          accounts={[ACCOUNT]}
          restore={restore}
        />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: /^Pulihkan Nasi padang/ }));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1);
    });
    // Server memuat ulang daftar tanpa e1.
    rerender(props([item('e2', { description: 'Kopi' })]));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Pulihkan Kopi/ })).toHaveFocus();
    });
    fireEvent.click(screen.getByRole('button', { name: /^Pulihkan Kopi/ }));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(2);
    });
    rerender(props([]));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    });
  });

  it('daftar berubah lebih dulu dari hasil (store demo sinkron): fokus tetap ke judul', async () => {
    const holder: { rerender: (ui: React.ReactElement) => void } = { rerender: () => undefined };
    const gone = (
      <>
        <h1 id="sampah-judul">Sampah · Pribadi</h1>
        <TrashList ruang="pribadi" today={TODAY} items={[]} accounts={[]} restore={vi.fn()} />
      </>
    );
    const restore = vi.fn<Restore>(() => {
      act(() => {
        holder.rerender(gone);
      });
      return Promise.resolve(ok);
    });
    const { rerender } = view([item('e1')], restore);
    holder.rerender = rerender;
    fireEvent.click(screen.getByRole('button', { name: /^Pulihkan/ }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    });
  });
});
