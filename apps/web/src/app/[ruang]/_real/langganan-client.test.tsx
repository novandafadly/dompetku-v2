import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RencanaHost,
  DismissSubscriptionButton,
  PromoteSubscriptionButton,
} from './rencana-client';

afterEach(cleanup);

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  refresh: vi.fn(),
  dismiss: vi.fn<(...a: unknown[]) => Promise<{ ok: boolean }>>(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/components/ui/toast', () => ({ toast: mocks.toast }));
vi.mock('../_actions/langganan', () => ({
  dismissSubscriptionAction: (...a: unknown[]) => mocks.dismiss(...a),
}));
vi.mock('../_actions/rencana', () => ({
  archiveBillAction: vi.fn(),
  copyBudgetsAction: vi.fn(),
  createBillAction: vi.fn(),
  deleteBudgetAction: vi.fn(),
  payBillAction: vi.fn(),
  setBudgetAction: vi.fn(),
  skipBillAction: vi.fn(),
  unskipBillAction: vi.fn(),
  updateBillAction: vi.fn(),
}));
vi.mock('../_actions/entri', () => ({ voidEntryAction: vi.fn() }));

const HOST_PROPS = {
  ruang: 'pribadi' as const,
  month: '2026-11',
  range: '1 Nov – 30 Nov',
  rows: [],
  previous: {},
  billNameByRoot: {},
  bill: {
    bills: [],
    occurrences: [],
    accounts: [
      {
        id: 'a-bca',
        name: 'BCA',
        pocket: 'operasional' as const,
        walletType: 'bank' as const,
        balance: 2_000_000,
        openedOn: '2026-01-01' as const,
        archived: false,
      },
    ],
    categories: [
      {
        id: 'c-lang',
        name: 'Langganan',
        type: 'expense' as const,
        parentId: null,
        icon: 'tv',
        archived: false,
      },
    ],
    today: '2026-11-10' as const,
    wajibRoots: {},
  },
};

beforeEach(() => {
  mocks.toast.mockReset();
  mocks.dismiss.mockReset();
});

describe('Saran langganan (S16-LG2..LG3)', () => {
  it('Jadikan tagihan membuka BillSheet terisi awal dari saran', async () => {
    const user = userEvent.setup();
    render(
      <RencanaHost {...HOST_PROPS}>
        <PromoteSubscriptionButton
          prefill={{
            name: 'Netflix',
            amount: 54_000,
            dayOfMonth: 15,
            categoryId: 'c-lang',
            accountId: 'a-bca',
          }}
        />
      </RencanaHost>,
    );
    await user.click(screen.getByRole('button', { name: 'Jadikan tagihan Netflix' }));
    const nameInput = await screen.findByLabelText('Nama');
    expect(nameInput).toHaveValue('Netflix');
    expect(screen.getByLabelText(/Perkiraan/i)).toHaveValue('54.000');
    expect(screen.getByLabelText('Kategori')).toHaveValue('c-lang');
    expect(screen.getByLabelText(/Dompet/i)).toHaveValue('a-bca');
    expect(screen.getByLabelText(/Tanggal tiap bulan/i)).toHaveValue('15');
  });

  it('Abaikan memanggil dismissSubscriptionAction sekali, menampilkan toast sukses / galat', async () => {
    let resolveFn: (v: { ok: boolean }) => void = () => undefined;
    mocks.dismiss.mockReturnValueOnce(new Promise((r) => (resolveFn = r)));
    const user = userEvent.setup();
    render(
      <RencanaHost {...HOST_PROPS}>
        <DismissSubscriptionButton name="Netflix" amount={54_000} />
      </RencanaHost>,
    );
    const btn = screen.getByRole('button', { name: 'Abaikan Netflix' });
    await user.click(btn);
    await user.click(btn); // klik ganda saat berjalan diabaikan
    expect(mocks.dismiss).toHaveBeenCalledTimes(1);
    expect(mocks.dismiss).toHaveBeenCalledWith('pribadi', { name: 'Netflix', amount: 54_000 });
    resolveFn({ ok: true });
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({ message: 'Saran Netflix diabaikan' });
    });

    mocks.dismiss.mockResolvedValueOnce({ ok: false });
    await user.click(btn);
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({
        message: 'Belum berhasil mengabaikan saran. Coba lagi.',
        tone: 'info',
      });
    });
  });
});
