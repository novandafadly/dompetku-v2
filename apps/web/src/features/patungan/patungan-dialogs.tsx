'use client';

import { ArrowCounterClockwiseIcon } from '@/components/ui/icons/arrow-counter-clockwise';
import { TrashIcon } from '@/components/ui/icons/trash';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { LedgerErrorCode } from '@/features/ledger/types';
import { KolomKas } from '@/components/ui/kolom-kas';
import { dateLabel, PATUNGAN_COPY as C } from '@/features/ledger/patungan-copy';
import { patunganFailedText } from './galat';
import { balanceRows, netOf, partnerShareOf } from './present';
import type {
  SplitBalanceVM,
  SplitBillVM,
  SplitSettlementVM,
  SplitWalletVM,
  WalletsState,
} from '@/features/ledger/patungan-types';

/**
 * Dialog akibat (S12-AK1, AK2): hanya aksi yang MEMBALIK uang. Fokus awal `Kembali`; tombol bahaya
 * mengikuti pola dialog Utang. Pratinjau satu pengurangan dari data halaman; hasil akhir dari SQL.
 * Dompet Pribadi (`wallet`) datang dari action malas (R27): selama belum ada, kolom saldo dompet
 * tidak dirender dan kalimat tidak menyebut nama dompet.
 */

/** Hanya batal penerimaan yang bisa `saldo_negatif` (uang keluar dari dompet penerima). */
function failureText(code: LedgerErrorCode | null): string | undefined {
  if (code === null) return undefined;
  if (code === 'saldo_negatif') {
    return 'Saldo dompet tidak cukup, jadi saldonya akan negatif. Ketuk Tetap batalkan untuk melanjutkan.';
  }
  return patunganFailedText(code);
}

interface Common {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balance: SplitBalanceVM;
  wallets: WalletsState;
  busy: boolean;
  failure: LedgerErrorCode | null;
  /** Server sudah menolak `saldo_negatif` sekali: tombol `Tetap batalkan` bertahan. */
  force: boolean;
  onConfirm: () => void;
}

export function DeleteSplitDialog({
  bill,
  ...c
}: Common & {
  bill: SplitBillVM | null;
}) {
  if (bill === null) return null;
  const wallet: SplitWalletVM | undefined = c.wallets.data?.linked[bill.id];
  const net = netOf(c.balance);
  const rows = balanceRows(net, net - partnerShareOf(bill), c.balance.partner.name);
  return (
    <ConfirmDialog
      open={c.open}
      onOpenChange={c.onOpenChange}
      icon={<TrashIcon size={22} />}
      title={C.deleteTitle}
      description={
        <div className="flex flex-col gap-3">
          <p>
            {`Pengeluaran Bersama ${bill.description ?? bill.categoryName ?? 'ini'} dan pembagiannya dibatalkan.${
              wallet === undefined ? '' : ` Uangnya kembali ke ${wallet.name}.`
            }`}
          </p>
          {wallet === undefined ? null : (
            <KolomKas
              title={`Saldo ${wallet.name}`}
              caption={`Saldo ${wallet.name}`}
              rows={[
                { label: C.now, value: wallet.balance },
                { label: 'Perubahan', value: bill.amount, signed: true },
              ]}
              result={{ label: C.afterwards, value: wallet.balance + bill.amount }}
            />
          )}
          <KolomKas
            title={C.title}
            caption={C.title}
            rows={[
              { label: rows.nowLabel, value: rows.nowValue, impas: rows.nowImpas },
              { label: 'Perubahan', value: -partnerShareOf(bill), signed: true },
            ]}
            result={{ label: rows.afterLabel, value: rows.afterValue, impas: rows.afterImpas }}
          />
          <p>Bisa dipulihkan 90 hari dari Patungan dihapus.</p>
        </div>
      }
      confirmLabel={C.deleteConfirm}
      cancelLabel={C.back}
      onConfirm={c.onConfirm}
      holdOpen
      busy={c.busy}
      alert={failureText(c.failure)}
    />
  );
}

/** Batalkan pelunasan (pelunas) atau batalkan penerimaan (penerima). */
export function CancelSettlementDialog({
  settlement,
  as,
  ...c
}: Common & {
  settlement: SplitSettlementVM | null;
  as: 'settle' | 'receipt';
}) {
  if (settlement === null) return null;
  const partner = c.balance.partner.name;
  const wallet = c.wallets.data?.linked[settlement.id];
  if (as === 'receipt') {
    return (
      <ConfirmDialog
        open={c.open}
        onOpenChange={c.onOpenChange}
        icon={<ArrowCounterClockwiseIcon size={22} />}
        title={C.cancelReceiptTitle}
        description={
          <div className="flex flex-col gap-3">
            <p>
              {`Uangnya keluar lagi dari ${wallet === undefined ? 'dompetmu' : wallet.name} dan kembali menunggu di Bersama. Saldo patungan tidak berubah.`}
            </p>
            {wallet === undefined ? null : (
              <KolomKas
                title={`Saldo ${wallet.name}`}
                caption={`Saldo ${wallet.name}`}
                rows={[
                  { label: C.now, value: wallet.balance },
                  { label: 'Perubahan', value: -settlement.amount, signed: true },
                ]}
                result={{ label: C.afterwards, value: wallet.balance - settlement.amount }}
              />
            )}
          </div>
        }
        confirmLabel={c.force ? 'Tetap batalkan' : C.cancelReceiptConfirm}
        cancelLabel={C.back}
        onConfirm={c.onConfirm}
        holdOpen
        busy={c.busy}
        alert={failureText(c.failure)}
      />
    );
  }
  // Pelunas: utangnya ke penerima bertambah lagi; uang kembali ke dompet pribadinya.
  const net = netOf(c.balance);
  const rows = balanceRows(net, net - settlement.amount, partner);
  return (
    <ConfirmDialog
      open={c.open}
      onOpenChange={c.onOpenChange}
      icon={<ArrowCounterClockwiseIcon size={22} />}
      title={C.cancelSettleTitle}
      description={
        <div className="flex flex-col gap-3">
          <p>
            {`Pelunasan ${dateLabel(settlement.occurredOn)} dibatalkan.${
              wallet === undefined ? '' : ` Uangnya kembali ke ${wallet.name}`
            } dan utangmu ke ${partner} bertambah lagi.`}
          </p>
          {wallet === undefined ? null : (
            <KolomKas
              title={`Saldo ${wallet.name}`}
              caption={`Saldo ${wallet.name}`}
              rows={[
                { label: C.now, value: wallet.balance },
                { label: 'Perubahan', value: settlement.amount, signed: true },
              ]}
              result={{ label: C.afterwards, value: wallet.balance + settlement.amount }}
            />
          )}
          <KolomKas
            title={`Utang ke ${partner}`}
            caption={`Utang ke ${partner}`}
            rows={[
              { label: rows.nowLabel, value: rows.nowValue, impas: rows.nowImpas },
              { label: 'Perubahan', value: settlement.amount, signed: true },
            ]}
            result={{ label: rows.afterLabel, value: rows.afterValue, impas: rows.afterImpas }}
          />
        </div>
      }
      confirmLabel={c.force ? 'Tetap batalkan' : C.cancelSettleConfirm}
      cancelLabel={C.back}
      onConfirm={c.onConfirm}
      holdOpen
      busy={c.busy}
      alert={failureText(c.failure)}
    />
  );
}
