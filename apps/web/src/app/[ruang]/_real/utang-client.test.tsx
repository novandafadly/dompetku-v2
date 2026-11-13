import type { Route } from 'next';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountVM } from '@/features/ledger/types';
import type { DebtDetailVM, PayTarget } from '@/features/utang/types';
import {
  AddDebtButton,
  CancelPaymentButton,
  DeleteDebtButton,
  PayRowButton,
  RestoreDebtButton,
  UtangHost,
} from './utang-client';

const m = vi.hoisted(() => ({
  pay: vi.fn(),
  create: vi.fn(),
  void: vi.fn(),
  restoreDebt: vi.fn(),
  voidEntry: vi.fn(),
  restoreEntry: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../_actions/utang', () => ({
  payDebtAction: m.pay,
  createDebtAction: m.create,
  voidDebtAction: m.void,
  restoreDebtAction: m.restoreDebt,
  createContactAction: vi.fn(),
  updateDebtInfoAction: vi.fn(),
  renameContactAction: vi.fn(),
  archiveContactAction: vi.fn(),
}));
vi.mock('../_actions/entri', () => ({
  voidEntryAction: m.voidEntry,
  restoreEntryAction: m.restoreEntry,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: m.push, refresh: m.refresh, back: vi.fn() }),
}));
vi.mock('@/components/ui/toast', () => ({ toast: m.toast }));

function clientIdOf(call: unknown[] | undefined): string {
  return (call?.[1] as { clientId: string }).clientId;
}

function last<T>(xs: T[]): T {
  const v = xs.at(-1);
  if (v === undefined) throw new Error('kosong');
  return v;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

const ACCOUNTS: AccountVM[] = [
  {
    id: 'a1',
    name: 'BCA',
    pocket: 'operasional',
    walletType: 'bank',
    openedOn: '2026-01-01',
    archived: false,
    balance: 5_000_000,
  },
];
const TARGET: PayTarget = {
  debtId: 'd1',
  contactName: 'Budi',
  direction: 'borrowed',
  principal: 2_000_000,
  remaining: 1_500_000,
  quick: { p25: 375_000, p50: 750_000, full: 1_500_000 },
  openedOn: '2026-10-12',
  accountId: 'a1',
};
const DETAIL: DebtDetailVM = {
  ...TARGET,
  paid: 500_000,
  paidPct: 25,
  settled: false,
  contactId: 'c1',
  contactArchived: false,
  mode: 'baru',
  title: null,
  note: null,
  createdAt: '2026-10-12T09:00:00+07:00',
  principalEntryId: 'p1',
  accountName: 'BCA',
  payments: [
    {
      entryId: 'pay1',
      version: 3,
      occurredOn: '2026-10-14',
      accountId: 'a1',
      accountName: 'BCA',
      amount: 500_000,
      voided: false,
      voidedAt: null,
      voidedWithDebt: false,
      createdAt: '2026-10-14T10:00:00+07:00',
    },
  ],
  voidEffects: [{ accountId: 'a1', accountName: 'BCA', amount: 1_500_000 }],
};

function host(children: React.ReactNode, detail?: DebtDetailVM) {
  render(
    <UtangHost
      ruang="pribadi"
      today="2026-11-13"
      accounts={ACCOUNTS}
      contacts={[]}
      targets={[TARGET]}
      detail={detail}
      listHref={'/pribadi/rencana?bagian=utang' as Route}
    >
      {children}
    </UtangHost>,
  );
}

describe('UtangHost: Bayar', () => {
  it('Bayar membuka sheet, mengirim ke Server Action Pribadi, toast dengan Urungkan membatalkan entri itu', async () => {
    const user = userEvent.setup();
    m.pay.mockResolvedValue({
      ok: true,
      value: { entryId: 'e9', version: 1, remaining: 1_125_000 },
    });
    m.voidEntry.mockResolvedValue({ ok: true, value: { version: 2 } });
    host(<PayRowButton debtId="d1" name="Budi" direction="borrowed" />);
    await user.click(screen.getByRole('button', { name: 'Bayar utang ke Budi' }));
    await user.type(await screen.findByRole('textbox', { name: 'Jumlah dibayar' }), '375000');
    await user.click(screen.getByRole('button', { name: /^Bayar Rp\s375\.000$/ }));
    await waitFor(() => {
      expect(m.pay).toHaveBeenCalled();
    });
    const [ruang, input] = m.pay.mock.calls[0] as [string, Record<string, unknown>];
    expect(ruang).toBe('pribadi');
    expect(input).toMatchObject({
      debtId: 'd1',
      accountId: 'a1',
      amount: 375_000,
      allowNegative: false,
    });
    expect(typeof input.clientId).toBe('string');
    await waitFor(() => {
      expect(m.toast).toHaveBeenCalled();
    });
    const toastArg = m.toast.mock.calls[0]?.[0] as {
      message: string;
      action: { label: string; onAction: () => void };
    };
    expect(toastArg.message).toMatch(
      /^Dibayar ke Budi · Rp\s375\.000 dari BCA · sisa Rp\s1\.125\.000$/,
    );
    expect(toastArg.action.label).toBe('Urungkan');
    toastArg.action.onAction();
    await waitFor(() => {
      expect(m.voidEntry).toHaveBeenCalledWith('pribadi', {
        clientId: expect.any(String) as string,
        entryId: 'e9',
        expectedVersion: 1,
      });
    });
  });

  it('lunas: toast Utang ke … lunas', async () => {
    const user = userEvent.setup();
    m.pay.mockResolvedValue({ ok: true, value: { entryId: 'e9', version: 1, remaining: 0 } });
    host(<PayRowButton debtId="d1" name="Budi" direction="borrowed" />);
    await user.click(screen.getByRole('button', { name: 'Bayar utang ke Budi' }));
    await user.click(await screen.findByRole('radio', { name: /^Lunas/ }));
    await user.click(screen.getByRole('button', { name: /^Lunasi/ }));
    await waitFor(() => {
      expect(m.toast).toHaveBeenCalled();
    });
    expect((m.toast.mock.calls[0]?.[0] as { message: string }).message).toMatch(
      /^Utang ke Budi lunas · Rp\s1\.500\.000 dari BCA$/,
    );
  });
});

describe('UtangHost: Tambah', () => {
  it('Tambah utang membuka sheet kosong; sukses menutup dan toast tanpa Urungkan', async () => {
    const user = userEvent.setup();
    m.create.mockResolvedValue({ ok: true, value: { debtId: 'dn' } });
    host(<AddDebtButton variant="primary" />);
    await user.click(screen.getByRole('button', { name: 'Tambah utang' }));
    await user.click(await screen.findByRole('radio', { name: 'Saya berutang' }));
    await user.type(screen.getByRole('textbox', { name: 'Nama kontak' }), 'Dewi');
    await user.type(screen.getByRole('textbox', { name: 'Jumlah pinjaman' }), '2000000');
    await user.click(screen.getByRole('button', { name: 'Simpan utang' }));
    await waitFor(() => {
      expect(m.create).toHaveBeenCalled();
    });
    expect(m.create.mock.calls[0]?.[1]).toMatchObject({
      direction: 'borrowed',
      mode: 'baru',
      principal: 2_000_000,
      contactName: 'Dewi',
      accountId: 'a1',
    });
    await waitFor(() => {
      expect(m.toast).toHaveBeenCalled();
    });
    expect((m.toast.mock.calls[0]?.[0] as { message: string }).message).toMatch(
      /^Utang ke Dewi dicatat di Pribadi · Rp\s2\.000\.000 masuk ke BCA$/,
    );
  });
});

describe('UtangHost: Pulihkan', () => {
  it('berhasil: toast dipulihkan; ditolak: pesan di bawah baris tanpa nominal', async () => {
    const user = userEvent.setup();
    m.restoreDebt.mockResolvedValueOnce({ ok: false, error: { code: 'saldo_negatif' } });
    host(<RestoreDebtButton debtId="d1" name="Budi" direction="borrowed" />);
    await user.click(screen.getByRole('button', { name: 'Pulihkan utang ke Budi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Belum bisa dipulihkan. Saldo dompet tidak cukup untuk mengembalikan pembayarannya.',
    );
    m.restoreDebt.mockResolvedValueOnce({ ok: true, value: {} });
    await user.click(screen.getByRole('button', { name: 'Pulihkan utang ke Budi' }));
    await waitFor(() => {
      expect(m.toast).toHaveBeenCalledWith({ message: 'Utang ke Budi dipulihkan di Pribadi' });
    });
    // Klien sama dipakai ulang untuk percobaan yang sama (idempoten).
    expect(clientIdOf(m.restoreDebt.mock.calls[0])).toBe(clientIdOf(m.restoreDebt.mock.calls[1]));
  });
});

describe('UtangHost: dialog akibat', () => {
  it('Hapus utang: Kembali fokus awal; konfirmasi memanggil void, kembali ke daftar, toast Urungkan = restore', async () => {
    const user = userEvent.setup();
    m.void.mockResolvedValue({
      ok: true,
      value: { debtId: 'd1', affected: [], effects: [], replayed: false },
    });
    m.restoreDebt.mockResolvedValue({ ok: true, value: {} });
    host(<DeleteDebtButton />, DETAIL);
    await user.click(screen.getByRole('button', { name: 'Hapus utang' }));
    expect(await screen.findByRole('button', { name: 'Kembali' })).toHaveFocus();
    await user.click(last(screen.getAllByRole('button', { name: 'Hapus utang' })));
    await waitFor(() => {
      expect(m.void).toHaveBeenCalledWith('pribadi', {
        clientId: expect.any(String) as string,
        debtId: 'd1',
        allowNegative: false,
      });
    });
    await waitFor(() => {
      expect(m.push).toHaveBeenCalledWith('/pribadi/rencana?bagian=utang');
    });
    const t = m.toast.mock.calls[0]?.[0] as { message: string; action: { onAction: () => void } };
    expect(t.message).toBe('Utang ke Budi dihapus di Pribadi');
    t.action.onAction();
    await waitFor(() => {
      expect(m.restoreDebt).toHaveBeenCalledWith('pribadi', {
        clientId: expect.any(String) as string,
        debtId: 'd1',
      });
    });
  });

  it('Hapus ditolak saldo_negatif: pesan, tombol Tetap hapus, kirim ulang dengan allowNegative', async () => {
    const user = userEvent.setup();
    m.void.mockResolvedValueOnce({ ok: false, error: { code: 'saldo_negatif' } });
    host(<DeleteDebtButton />, DETAIL);
    await user.click(screen.getByRole('button', { name: 'Hapus utang' }));
    await user.click(last(await screen.findAllByRole('button', { name: 'Hapus utang' })));
    const again = await screen.findByRole('button', { name: 'Tetap hapus' });
    m.void.mockResolvedValueOnce({
      ok: true,
      value: { debtId: 'd1', affected: [], effects: [], replayed: false },
    });
    await user.click(again);
    await waitFor(() => {
      expect(m.void).toHaveBeenCalledTimes(2);
    });
    expect(m.void.mock.calls[1]?.[1]).toMatchObject({ allowNegative: true });
    expect(clientIdOf(m.void.mock.calls[0])).toBe(clientIdOf(m.void.mock.calls[1]));
  });

  it('Tetap hapus bertahan walau percobaan berikutnya gagal jaringan (allowNegative tetap true, clientId sama)', async () => {
    const user = userEvent.setup();
    m.void
      .mockResolvedValueOnce({ ok: false, error: { code: 'saldo_negatif' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'network' } })
      .mockResolvedValueOnce({
        ok: true,
        value: { debtId: 'd1', affected: [], effects: [], replayed: false },
      });
    host(<DeleteDebtButton />, DETAIL);
    await user.click(screen.getByRole('button', { name: 'Hapus utang' }));
    await user.click(last(await screen.findAllByRole('button', { name: 'Hapus utang' })));
    await user.click(await screen.findByRole('button', { name: 'Tetap hapus' }));
    await waitFor(() => {
      expect(m.void).toHaveBeenCalledTimes(2);
    });
    // Galat jaringan menimpa pesan, tetapi konfirmasi pengguna tidak hilang.
    const again = await screen.findByRole('button', { name: 'Tetap hapus' });
    await user.click(again);
    await waitFor(() => {
      expect(m.void).toHaveBeenCalledTimes(3);
    });
    expect(m.void.mock.calls[1]?.[1]).toMatchObject({ allowNegative: true });
    expect(m.void.mock.calls[2]?.[1]).toMatchObject({ allowNegative: true });
    expect(clientIdOf(m.void.mock.calls[0])).toBe(clientIdOf(m.void.mock.calls[2]));
  });

  it('Batalkan pembayaran: dialog memuat dua kolom; konfirmasi memakai versi entri, Urungkan = restore entri', async () => {
    const user = userEvent.setup();
    m.voidEntry.mockResolvedValue({ ok: true, value: { version: 4 } });
    m.restoreEntry.mockResolvedValue({ ok: true, value: { version: 5 } });
    host(<CancelPaymentButton entryId="pay1" occurredOn="2026-10-14" />, DETAIL);
    await user.click(screen.getByRole('button', { name: 'Batalkan pembayaran 14 Okt 2026' }));
    expect(await screen.findByRole('table', { name: 'Saldo BCA' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Batalkan pembayaran' }));
    await waitFor(() => {
      expect(m.voidEntry).toHaveBeenCalledWith('pribadi', {
        clientId: expect.any(String) as string,
        entryId: 'pay1',
        expectedVersion: 3,
      });
    });
    await waitFor(() => {
      expect(m.toast).toHaveBeenCalled();
    });
    const t = m.toast.mock.calls[0]?.[0] as { message: string; action: { onAction: () => void } };
    expect(t.message).toMatch(/^Pembayaran dibatalkan · Pribadi · Rp\s500\.000$/);
    t.action.onAction();
    await waitFor(() => {
      expect(m.restoreEntry).toHaveBeenCalledWith('pribadi', {
        clientId: expect.any(String) as string,
        entryId: 'pay1',
        expectedVersion: 4,
      });
    });
  });
});
