import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountVM } from '@/features/ledger/types';
import { CancelPaymentDialog, DeleteDebtDialog } from './debt-dialogs';
import type { DebtDetailVM, DebtPaymentVM } from './types';

afterEach(cleanup);

const PAYMENT: DebtPaymentVM = {
  entryId: 'e1',
  version: 1,
  occurredOn: '2026-10-14',
  accountId: 'a1',
  accountName: 'BCA',
  amount: 375_000,
  voided: false,
  voidedAt: null,
  voidedWithDebt: false,
  createdAt: '2026-10-14T10:00:00+07:00',
};
const ACCOUNT: AccountVM = {
  id: 'a1',
  name: 'BCA',
  pocket: 'operasional',
  walletType: 'bank',
  openedOn: '2026-01-01',
  archived: false,
  balance: 4_000_000,
};

describe('CancelPaymentDialog (S11-AK1)', () => {
  function setup(direction: 'borrowed' | 'lent', failure = null as null | 'debt_deleted') {
    const onConfirm = vi.fn();
    render(
      <CancelPaymentDialog
        open
        onOpenChange={vi.fn()}
        payment={PAYMENT}
        detail={{ direction, remaining: 1_125_000 }}
        account={ACCOUNT}
        busy={false}
        failure={failure}
        onConfirm={onConfirm}
      />,
    );
    return { onConfirm };
  }

  it('fokus awal di Kembali; dua KolomKas dengan tanda + dan garis ganda; kalimat Utang', async () => {
    setup('borrowed');
    const dialog = await screen.findByRole('alertdialog', { name: 'Batalkan pembayaran ini?' });
    expect(screen.getByRole('button', { name: 'Kembali' })).toHaveFocus();
    expect(dialog).toHaveTextContent(
      /Pembayaran 14 Okt 2026 dibatalkan\. Uangnya kembali ke BCA dan sisa utang bertambah lagi\./,
    );
    const wallet = within(dialog).getByRole('table', { name: 'Saldo BCA' });
    expect(wallet).toHaveTextContent(/SekarangRp\s4\.000\.000/);
    expect(wallet).toHaveTextContent(/Perubahan\+Rp\s375\.000/);
    expect(wallet).toHaveTextContent(/SesudahnyaRp\s4\.375\.000/);
    const debt = within(dialog).getByRole('table', { name: 'Sisa utang' });
    expect(debt).toHaveTextContent(/SekarangRp\s1\.125\.000/);
    expect(debt).toHaveTextContent(/SesudahnyaRp\s1\.500\.000/);
    expect(debt.querySelector('tfoot tr')).toHaveClass('border-double');
  });

  it('Piutang: uang keluar lagi, saldo berkurang', async () => {
    setup('lent');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(
      /Uangnya keluar lagi dari BCA dan sisa piutang bertambah lagi\./,
    );
    expect(within(dialog).getByRole('table', { name: 'Saldo BCA' })).toHaveTextContent(
      /SesudahnyaRp\s3\.625\.000/,
    );
  });

  it('Batalkan pembayaran memanggil onConfirm; galat tampil sebagai alert tanpa nominal', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup('borrowed', 'debt_deleted');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Utang ini sudah dihapus. Pulihkan utangnya dulu.',
    );
    await user.click(screen.getByRole('button', { name: 'Batalkan pembayaran' }));
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe('DeleteDebtDialog (S11-AK2)', () => {
  const base: Pick<
    DebtDetailVM,
    'direction' | 'contactName' | 'voidEffects' | 'mode' | 'payments'
  > = {
    direction: 'borrowed',
    contactName: 'Budi',
    mode: 'baru',
    payments: [PAYMENT],
    voidEffects: [{ accountId: 'a1', accountName: 'BCA', amount: 1_625_000 }],
  };

  it('daftar efek bersih per dompet bertanda, tanpa total; kalimat 90 hari; Sisa menjadi tidak ada', async () => {
    render(
      <DeleteDebtDialog
        open
        onOpenChange={vi.fn()}
        detail={base}
        busy={false}
        failure={null}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Hapus utang ke Budi?' });
    expect(dialog).toHaveTextContent(/Bisa dipulihkan 90 hari dari Utang dihapus\./);
    const table = within(dialog).getByRole('table', { name: 'Saldo dompet berubah' });
    expect(table).toHaveTextContent(/Saldo BCA\+Rp\s1\.625\.000/);
    expect(table.querySelector('tfoot')).toBeNull();
    expect(dialog).toHaveTextContent('Sisa utang ke Budi menjadi tidak ada.');
    expect(screen.getByRole('button', { name: 'Kembali' })).toHaveFocus();
  });

  it('berjalan tanpa pembayaran: tanpa kolom, satu kalimat Saldo dompet tidak berubah', async () => {
    render(
      <DeleteDebtDialog
        open
        onOpenChange={vi.fn()}
        detail={{ ...base, mode: 'berjalan', payments: [], voidEffects: [] }}
        busy={false}
        failure={null}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).queryByRole('table')).toBeNull();
    expect(dialog).toHaveTextContent('Saldo dompet tidak berubah.');
  });

  it('saldo_negatif: pesan dan tombol berganti Tetap hapus', async () => {
    render(
      <DeleteDebtDialog
        open
        onOpenChange={vi.fn()}
        detail={base}
        busy={false}
        failure="saldo_negatif"
        onConfirm={vi.fn()}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Tetap hapus' })).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('Piutang memakai kata piutang', async () => {
    render(
      <DeleteDebtDialog
        open
        onOpenChange={vi.fn()}
        detail={{ ...base, direction: 'lent' }}
        busy={false}
        failure={null}
        onConfirm={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole('alertdialog', { name: 'Hapus piutang pada Budi?' }),
    ).toBeTruthy();
  });
});
