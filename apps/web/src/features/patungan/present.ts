import type { Rupiah } from '@dompetku/domain';
import type { SplitBalanceVM, SplitBillVM } from '@/features/ledger/patungan-types';

/**
 * Pratinjau akibat di dialog (satu pengurangan, preseden S6-C3/S11); hasil akhir selalu dari SQL.
 * `net` = saldo patungan dari sudut pandang penonton: positif = lawan berutang kepadaku, negatif
 * = aku berutang kepada lawan, 0 = impas. Diturunkan dari kalimat SQL (`debtorId`, `amount`).
 */
export function netOf(vm: Pick<SplitBalanceVM, 'me' | 'debtorId' | 'amount'>): number {
  if (vm.debtorId === null || vm.amount === null) return 0;
  return vm.debtorId === vm.me.id ? -vm.amount : vm.amount;
}

/** Bagian lawan (bukan pembayar) pada sebuah tagihan, dari SQL. */
export function partnerShareOf(bill: SplitBillVM): Rupiah {
  return bill.shares.find((s) => s.userId !== bill.payerId)?.amount ?? 0;
}

export interface BalanceRows {
  /** Label baris `sekarang`: siapa berutang (atau `Sekarang` bila impas). */
  nowLabel: string;
  nowValue: Rupiah;
  nowImpas: boolean;
  afterLabel: string;
  afterValue: Rupiah;
  afterImpas: boolean;
}

/** Baris `KolomKas` saldo patungan sebelum dan sesudah `net → netAfter`. */
export function balanceRows(net: number, netAfter: number, partnerName: string): BalanceRows {
  return {
    nowLabel:
      net === 0
        ? 'Sekarang'
        : net < 0
          ? 'Kamu berutang sekarang'
          : `${partnerName} berutang sekarang`,
    nowValue: Math.abs(net),
    nowImpas: net === 0,
    afterLabel:
      netAfter === 0
        ? 'Sesudahnya'
        : netAfter < 0
          ? 'Sesudahnya: kamu berutang'
          : `Sesudahnya: ${partnerName} berutang`,
    afterValue: Math.abs(netAfter),
    afterImpas: netAfter === 0,
  };
}
