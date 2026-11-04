import { formatRupiah } from '@dompetku/domain';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchiveButton, ReconcileButton, RECONCILE_UNDO_FAILED } from './dompet-actions-client';

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
  archive: vi.fn(),
  voidEntry: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../_actions/dompet', () => ({
  reconcileAction: mocks.reconcile,
  archiveAccountAction: mocks.archive,
}));
vi.mock('../_actions/entri', () => ({ voidEntryAction: mocks.voidEntry }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
}));
vi.mock('@/components/ui/toast', () => ({ toast: mocks.toast }));

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

const account = { id: 'a1', name: 'BCA', balance: 1_250_000 };

async function reconcileTo(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.click(screen.getByRole('button', { name: 'Cocokkan saldo' }));
  const input = await screen.findByRole('textbox', { name: 'Saldo sebenarnya' });
  await user.type(input, value);
  await user.click(screen.getByRole('button', { name: 'Cocokkan saldo', description: /./ }));
}

describe('ReconcileButton (Dompet nyata)', () => {
  it('tombol membuka sheet (dimuat malas); simpan memanggil reconcileAction dengan ruang, dompet, saldo nyata', async () => {
    const user = userEvent.setup();
    mocks.reconcile.mockResolvedValue({
      ok: true,
      value: { entryId: 'adj-1', difference: 250_000, replayed: false },
    });
    render(<ReconcileButton ruang="pribadi" account={account} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await reconcileTo(user, '1500000');
    await waitFor(() => {
      expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    });
    expect(mocks.reconcile).toHaveBeenCalledWith('pribadi', {
      clientId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      accountId: 'a1',
      actualBalance: 1_500_000,
    });
    await waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalled();
    });
  });

  it('toast memakai selisih dari server dan Urungkan membatalkan entri penyesuaian (versi 1)', async () => {
    const user = userEvent.setup();
    // Server melaporkan selisih sebenarnya (300.000), bukan pratinjau (250.000).
    mocks.reconcile.mockResolvedValue({
      ok: true,
      value: { entryId: 'adj-1', difference: 300_000, replayed: false },
    });
    mocks.voidEntry.mockResolvedValue({ ok: true, value: { version: 2 } });
    render(<ReconcileButton ruang="pribadi" account={account} />);
    await reconcileTo(user, '1500000');
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledTimes(1);
    });
    const t = mocks.toast.mock.calls[0]?.[0] as {
      message: string;
      action: { label: string; onAction: () => void };
    };
    expect(t.message).toBe(
      `Saldo BCA dicocokkan di Pribadi · selisih ${formatRupiah(300_000, { sign: 'always' })}`,
    );
    expect(t.action.label).toBe('Urungkan');
    mocks.refresh.mockClear();
    t.action.onAction();
    await waitFor(() => {
      expect(mocks.voidEntry).toHaveBeenCalledWith('pribadi', {
        clientId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
        entryId: 'adj-1',
        expectedVersion: 1,
      });
    });
    await waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalled();
    });
  });

  it('Urungkan gagal: toast pemberitahuan, tanpa muat ulang', async () => {
    const user = userEvent.setup();
    mocks.reconcile.mockResolvedValue({
      ok: true,
      value: { entryId: 'adj-1', difference: -50_000, replayed: false },
    });
    mocks.voidEntry.mockResolvedValue({ ok: false, error: { code: 'saldo_negatif' } });
    render(<ReconcileButton ruang="bersama" account={account} />);
    await reconcileTo(user, '1200000');
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledTimes(1);
    });
    const t = mocks.toast.mock.calls[0]?.[0] as {
      message: string;
      action: { onAction: () => void };
    };
    expect(t.message).toContain('di Bersama');
    expect(t.message).toContain(formatRupiah(-50_000));
    mocks.refresh.mockClear();
    t.action.onAction();
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({ message: RECONCILE_UNDO_FAILED, tone: 'info' });
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('di server selisihnya sudah 0 (entryId null): toast tanpa Urungkan', async () => {
    const user = userEvent.setup();
    mocks.reconcile.mockResolvedValue({
      ok: true,
      value: { entryId: null, difference: 0, replayed: false },
    });
    render(<ReconcileButton ruang="pribadi" account={account} />);
    await reconcileTo(user, '1500000');
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledTimes(1);
    });
    const t = mocks.toast.mock.calls[0]?.[0] as { message: string; action?: unknown };
    expect(t.message).toBe('Saldo BCA sudah sama. Tidak ada yang dicatat.');
    expect(t.action).toBeUndefined();
  });
});

describe('ArchiveButton (Dompet nyata)', () => {
  const dompetHref = '/pribadi/dompet?theme=light' as never;
  const props = { ruang: 'pribadi' as const, account: { id: 'a1', name: 'BCA' }, dompetHref };

  it('Arsipkan dompet membuka dialog; konfirmasi memanggil archiveAccountAction, toast, lalu kembali ke daftar Dompet', async () => {
    const user = userEvent.setup();
    mocks.archive.mockResolvedValue({ ok: true, value: { archived: true } });
    render(<ArchiveButton {...props} />);
    await user.click(screen.getByRole('button', { name: 'Arsipkan dompet' }));
    await screen.findByRole('alertdialog', { name: 'Arsipkan BCA?' });
    await user.click(screen.getByRole('button', { name: 'Arsipkan' }));
    await waitFor(() => {
      expect(mocks.archive).toHaveBeenCalledWith('pribadi', 'a1');
    });
    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith(dompetHref);
    });
    expect(mocks.toast).toHaveBeenCalledWith({ message: 'BCA diarsipkan di Pribadi' });
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });

  it('race balance_not_zero: dialog tetap terbuka dengan galat, tombol aria-disabled, tanpa pindah halaman', async () => {
    const user = userEvent.setup();
    mocks.archive.mockResolvedValue({ ok: false, error: { code: 'balance_not_zero' } });
    render(<ArchiveButton {...props} />);
    await user.click(screen.getByRole('button', { name: 'Arsipkan dompet' }));
    await user.click(await screen.findByRole('button', { name: 'Arsipkan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'BCA masih berisi saldo, jadi belum bisa diarsipkan. Pindahkan isinya dulu.',
    );
    expect(screen.getByRole('button', { name: 'Arsipkan' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('putus jaringan: galat di dialog dan bisa dicoba lagi', async () => {
    const user = userEvent.setup();
    mocks.archive
      .mockRejectedValueOnce(new Error('putus'))
      .mockResolvedValue({ ok: true, value: { archived: true } });
    render(<ArchiveButton {...props} />);
    await user.click(screen.getByRole('button', { name: 'Arsipkan dompet' }));
    await user.click(await screen.findByRole('button', { name: 'Arsipkan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Periksa koneksi');
    await user.click(screen.getByRole('button', { name: 'Arsipkan' }));
    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith(dompetHref);
    });
  });
});
