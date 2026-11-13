import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountVM } from '@/features/ledger/types';
import {
  PayDebtSheet,
  type PayDebtSheetProps,
  type PayResult,
  type PaySubmit,
} from './pay-debt-sheet';
import type { PayTarget } from './types';

afterEach(cleanup);

const ACCOUNTS: AccountVM[] = [
  {
    id: 'a-bca',
    name: 'BCA',
    pocket: 'operasional',
    walletType: 'bank',
    openedOn: '2026-01-01',
    archived: false,
    balance: 2_000_000,
  },
  {
    id: 'a-kantor',
    name: 'Kas Kantor',
    pocket: 'kantor',
    walletType: 'cash',
    openedOn: '2026-01-01',
    archived: false,
    balance: 500,
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
  accountId: 'a-bca',
};

function setup(
  over: Partial<PayDebtSheetProps> = {},
  result: PayResult = { ok: true, entryId: 'e1', version: 1, remaining: 1_125_000 },
) {
  const onPay = vi.fn<(i: PaySubmit) => Promise<PayResult>>(() => Promise.resolve(result));
  const onPaid = vi.fn();
  const onRefresh = vi.fn();
  render(
    <PayDebtSheet
      open
      onOpenChange={vi.fn()}
      target={TARGET}
      accounts={ACCOUNTS}
      today="2026-11-13"
      onPay={onPay}
      onPaid={onPaid}
      onRefresh={onRefresh}
      {...over}
    />,
  );
  return { onPay, onPaid, onRefresh };
}

const amountBox = () => screen.getByRole('textbox', { name: 'Jumlah dibayar' });
const submit = () => {
  const b = screen.getAllByRole('button').find((x) => x.getAttribute('type') === 'submit');
  if (b === undefined) throw new Error('tombol simpan tidak ada');
  return b;
};

describe('PayDebtSheet (S11-BY1)', () => {
  it('judul menyebut ruang; sisa dan pokok tampil; fokus awal di Jumlah; dompet bawaan = dompet pokok', async () => {
    setup();
    expect(
      await screen.findByRole('dialog', { name: /^Bayar utang ke Budi\s*Pribadi$/ }),
    ).toBeTruthy();
    expect(screen.getByText(/Sisa Rp\s1\.500\.000/)).toBeTruthy();
    expect(screen.getByText(/dari Rp\s2\.000\.000/)).toBeTruthy();
    expect(amountBox()).toHaveFocus();
    expect(screen.getByRole('combobox', { name: 'Dibayar dari' })).toHaveValue('a-bca');
    // Dompet Kantor tidak ditawarkan.
    expect(screen.queryByRole('option', { name: 'Kas Kantor' })).toBeNull();
  });

  it('pintasan mengisi kolom (dari SQL), terpilih diturunkan dari nilai, Lunas = sisa', async () => {
    const user = userEvent.setup();
    setup();
    const group = screen.getByRole('radiogroup', { name: 'Pintasan jumlah' });
    const chips = within(group).getAllByRole('radio');
    expect(chips.map((c) => c.textContent.replace(/\s/g, ' '))).toEqual([
      '25%25% dari sisa, Rp 375.000',
      '50%50% dari sisa, Rp 750.000',
      'LunasLunas, Rp 1.500.000',
    ]);
    await user.click(within(group).getByRole('radio', { name: /^25%/ }));
    expect(amountBox()).toHaveValue('375.000');
    expect(within(group).getByRole('radio', { name: /^25%/ })).toBeChecked();
    expect(submit()).toHaveTextContent(/^Bayar Rp\s375\.000$/);
    await user.click(within(group).getByRole('radio', { name: /^Lunas/ }));
    expect(submit()).toHaveTextContent(/^Lunasi Rp\s1\.500\.000$/);
  });

  it('pintasan null disembunyikan, tanpa Rp 0', () => {
    setup({
      target: { ...TARGET, remaining: 1, quick: { p25: null, p50: null, full: 1 } },
    });
    const chips = within(screen.getByRole('radiogroup', { name: 'Pintasan jumlah' })).getAllByRole(
      'radio',
    );
    expect(chips).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/Rp\s0\b/);
  });

  it('KolomKas Setelah ini: sisa sekarang, dibayar bertanda −, sisa sesudahnya; saldo berkurang', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(amountBox(), '375000');
    const table = screen.getByRole('table', { name: 'Setelah ini' });
    expect(table).toHaveTextContent(/Sisa sekarangRp\s1\.500\.000/);
    expect(table).toHaveTextContent(/Dibayar−Rp\s375\.000/);
    expect(table).toHaveTextContent(/Sisa sesudahnyaRp\s1\.125\.000/);
    expect(screen.getByText(/Saldo BCA berkurang Rp\s375\.000/)).toBeTruthy();
  });

  it('bayar lebih: galat kolom, Bayar sisa mengisi kolom (tidak menyimpan), tidak mengirim', async () => {
    const user = userEvent.setup();
    const { onPay } = setup();
    await user.type(amountBox(), '2000000');
    expect(screen.getByText(/lebih besar dari sisa/)).toBeTruthy();
    expect(amountBox().getAttribute('aria-describedby')).toBeTruthy();
    await user.click(submit());
    expect(onPay).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^Bayar sisa Rp\s1\.500\.000$/ }));
    expect(onPay).not.toHaveBeenCalled();
    expect(amountBox()).toHaveValue('1.500.000');
    expect(screen.queryByText(/lebih besar dari sisa/)).toBeNull();
  });

  it('kirim: clientId, dompet, tanggal, jumlah; sukses memanggil onPaid dengan sisa dari SQL', async () => {
    const user = userEvent.setup();
    const { onPay, onPaid } = setup();
    await user.type(amountBox(), '375000');
    await user.click(submit());
    await waitFor(() => {
      expect(onPaid).toHaveBeenCalled();
    });
    expect(onPay).toHaveBeenCalledTimes(1);
    expect(onPay.mock.calls[0]?.[0]).toMatchObject({
      debtId: 'd1',
      accountId: 'a-bca',
      amount: 375_000,
      occurredOn: '2026-11-13',
      allowNegative: false,
    });
    expect(onPaid.mock.calls[0]?.[0]).toMatchObject({ remaining: 1_125_000, name: 'Budi' });
  });

  it('klik ganda = satu permintaan (C6)', async () => {
    const user = userEvent.setup();
    let release: (r: PayResult) => void = () => undefined;
    const onPay = vi.fn(
      () =>
        new Promise<PayResult>((r) => {
          release = r;
        }),
    );
    setup({ onPay });
    await user.type(amountBox(), '100000');
    await user.dblClick(submit());
    release({ ok: true, entryId: 'e', version: 1, remaining: 1 });
    expect(onPay).toHaveBeenCalledTimes(1);
  });

  it('payment_exceeds dari server: muat ulang data, galat kolom, tidak menutup', async () => {
    const user = userEvent.setup();
    const { onRefresh, onPaid } = setup({}, { ok: false, code: 'payment_exceeds' });
    await user.type(amountBox(), '375000');
    await user.click(submit());
    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });
    expect(onPaid).not.toHaveBeenCalled();
    expect(screen.getByText(/lebih besar dari sisa/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Bayar sisa/ })).toBeTruthy();
  });

  it('saldo kurang (hanya Saya berutang): kotak peringatan, tombol Tetap bayar, allowNegative', async () => {
    const user = userEvent.setup();
    const { onPay } = setup({
      target: {
        ...TARGET,
        remaining: 5_000_000,
        principal: 5_000_000,
        quick: { p25: 1_250_000, p50: 2_500_000, full: 5_000_000 },
      },
    });
    await user.type(amountBox(), '3000000');
    expect(
      screen.getByText(
        /Saldo BCA tinggal Rp\s2\.000\.000\. Kalau dibayar, saldonya jadi −Rp\s1\.000\.000\./,
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Tetap bayar' }));
    expect(onPay.mock.calls[0]?.[0]).toMatchObject({ allowNegative: true });
  });

  it('Piutang: Terima, tanpa peringatan saldo, saldo bertambah', async () => {
    const user = userEvent.setup();
    setup({ target: { ...TARGET, direction: 'lent' } });
    expect(
      await screen.findByRole('dialog', { name: /^Terima dari Budi\s*Pribadi$/ }),
    ).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Jumlah diterima' }), '375000');
    expect(screen.getByText(/Saldo BCA bertambah Rp\s375\.000/)).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Setelah ini' })).toHaveTextContent(
      /Diterima−Rp\s375\.000/,
    );
    expect(screen.getByRole('button', { name: /^Terima Rp\s375\.000$/ })).toBeTruthy();
  });

  it('utang sudah lunas atau dihapus: kotak atas + Muat ulang, tanpa formulir', async () => {
    const user = userEvent.setup();
    const { onRefresh } = setup({
      target: { ...TARGET, remaining: 0, quick: { p25: null, p50: null, full: 0 } },
    });
    expect(
      screen.getByText('Utang ini sudah lunas atau dihapus. Muat ulang halaman.'),
    ).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Jumlah dibayar' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Muat ulang' }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('tanpa dompet: NoAccount dan tanpa tombol simpan', () => {
    setup({ accounts: ACCOUNTS.filter((a) => a.pocket === 'kantor') });
    expect(
      screen.getByText('Belum ada dompet di Pribadi. Tambah dompet dulu untuk membayar.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Bayar/ })).toBeNull();
  });

  it('tanggal bayar tidak lebih awal dari tanggal mulai utang', () => {
    setup({ target: { ...TARGET, openedOn: '2026-11-11' } });
    const opts = within(screen.getByRole('combobox', { name: 'Tanggal bayar' })).getAllByRole(
      'option',
    );
    expect(opts).toHaveLength(3);
  });
});
