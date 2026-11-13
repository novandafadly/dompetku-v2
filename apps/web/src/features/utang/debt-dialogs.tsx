'use client';

import { ArrowCounterClockwiseIcon } from '@/components/ui/icons/arrow-counter-clockwise';
import { TrashIcon } from '@/components/ui/icons/trash';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { AccountVM, LedgerErrorCode } from '@/features/ledger/types';
import { dateWithYear, UTANG_COPY as C } from './copy';
import { utangFailedText } from './galat';
import { KolomKas } from './kolom-kas';
import { cancelPreview } from './present';
import type { DebtDetailVM, DebtPaymentVM } from './types';

/**
 * Dialog akibat (S11-AK1, AK2): hanya aksi yang MEMBALIK uang. Fokus awal `Kembali`; tombol
 * bahaya mengikuti pola VoidDialog. Nilai pratinjau dari data halaman (satu penjumlahan),
 * hasil akhir dari SQL.
 */

function failureText(
  code: LedgerErrorCode | null,
  direction: DebtDetailVM['direction'],
  /** `delete`: bisa dilanjutkan (`Tetap hapus`); batal satu cicilan tidak punya jalur paksa. */
  kind: 'cancel' | 'delete',
): string | undefined {
  if (code === null) return undefined;
  if (code === 'saldo_negatif') {
    return kind === 'delete'
      ? 'Saldo dompet tidak cukup, jadi saldonya akan negatif. Ketuk Tetap hapus untuk melanjutkan.'
      : 'Belum bisa dibatalkan. Saldo dompet tidak cukup untuk membatalkan pembayaran ini.';
  }
  return utangFailedText(code, direction);
}

export function CancelPaymentDialog({
  open,
  onOpenChange,
  payment,
  detail,
  account,
  busy,
  failure,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: DebtPaymentVM | null;
  detail: Pick<DebtDetailVM, 'direction' | 'remaining'>;
  /** Dompet pembayaran (saldo sekarang); `undefined` bila sudah tidak ada di daftar. */
  account: AccountVM | undefined;
  busy: boolean;
  failure: LedgerErrorCode | null;
  onConfirm: () => void;
}) {
  if (payment === null) return null;
  const lent = detail.direction === 'lent';
  const wallet = payment.accountName;
  const preview = cancelPreview(
    detail.direction,
    payment.amount,
    detail.remaining,
    account?.balance ?? 0,
  );
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<ArrowCounterClockwiseIcon size={22} />}
      title={C.cancelPaymentTitle}
      description={
        <div className="flex flex-col gap-3">
          <p>
            {lent
              ? `Pembayaran ${dateWithYear(payment.occurredOn)} dibatalkan. Uangnya keluar lagi dari ${wallet} dan sisa piutang bertambah lagi.`
              : `Pembayaran ${dateWithYear(payment.occurredOn)} dibatalkan. Uangnya kembali ke ${wallet} dan sisa utang bertambah lagi.`}
          </p>
          {account === undefined ? null : (
            <KolomKas
              title={`Saldo ${wallet}`}
              caption={`Saldo ${wallet}`}
              rows={[
                { label: C.now, value: account.balance },
                { label: 'Perubahan', value: preview.walletDelta, signed: true },
              ]}
              result={{ label: C.afterwards, value: preview.walletAfter }}
            />
          )}
          <KolomKas
            title={C.debtBalanceTitle}
            caption={C.debtBalanceTitle}
            rows={[
              { label: C.now, value: detail.remaining },
              { label: 'Perubahan', value: payment.amount, signed: true },
            ]}
            result={{ label: C.afterwards, value: preview.remainingAfter }}
          />
        </div>
      }
      confirmLabel={C.cancelPayment}
      cancelLabel={C.back}
      onConfirm={onConfirm}
      holdOpen
      busy={busy}
      alert={failureText(failure, detail.direction, 'cancel')}
    />
  );
}

export function DeleteDebtDialog({
  open,
  onOpenChange,
  detail,
  busy,
  failure,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: Pick<
    DebtDetailVM,
    'direction' | 'contactName' | 'voidEffects' | 'mode' | 'payments'
  > | null;
  busy: boolean;
  failure: LedgerErrorCode | null;
  onConfirm: () => void;
}) {
  if (detail === null) return null;
  const lent = detail.direction === 'lent';
  const effects = detail.voidEffects;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<TrashIcon size={22} />}
      title={lent ? C.deleteTitleLent(detail.contactName) : C.deleteTitle(detail.contactName)}
      description={
        <div className="flex flex-col gap-3">
          <p>{C.deleteBody}</p>
          {effects.length === 0 ? (
            <p>{C.deleteNoEffects}</p>
          ) : (
            <KolomKas
              caption={C.deleteEffects}
              title={C.deleteEffects}
              rows={effects.map((e) => ({
                label: `Saldo ${e.accountName}`,
                value: e.amount,
                signed: true,
              }))}
            />
          )}
          <p>{lent ? C.deleteGoneLent(detail.contactName) : C.deleteGone(detail.contactName)}</p>
        </div>
      }
      confirmLabel={failure === 'saldo_negatif' ? 'Tetap hapus' : C.deleteDebt}
      cancelLabel={C.back}
      onConfirm={onConfirm}
      holdOpen
      busy={busy}
      alert={failureText(failure, detail.direction, 'delete')}
    />
  );
}
