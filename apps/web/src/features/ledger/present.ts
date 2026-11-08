import { formatRupiah, type Rupiah } from '@dompetku/domain';
import type { EntryVM } from './types';

/** Judul entri di daftar: deskripsi, lalu catatan bersama, lalu nama kategori. */
export function entryTitleVM(e: EntryVM): string {
  switch (e.kind) {
    case 'opening_balance':
      return 'Saldo awal';
    case 'adjustment':
      return 'Cocokkan saldo';
    case 'transfer':
      return e.description ?? 'Pindah dompet';
    case 'reimbursement':
      return e.description ?? 'Reimburse talangan';
    case 'space_transfer':
      // S7-D1: judul dari arah dan pencatat, bukan keterangan; kaki Bersama tidak menyebut Pribadi.
      if (e.spaceKind === 'shared') {
        return e.direction === 'in'
          ? `Setoran dari ${e.createdBy.name}`
          : `Diambil oleh ${e.createdBy.name}`;
      }
      if (e.spaceKind === 'personal') {
        return e.direction === 'in' ? 'Ambil dari Bersama' : 'Setor ke Bersama';
      }
      return (
        e.sharedNote ??
        e.description ??
        (e.direction === 'in' ? 'Setoran dari Pribadi' : 'Setoran ke Bersama')
      );
    default:
      return e.description ?? e.categoryName ?? 'Tanpa kategori';
  }
}

/** Label jenis/kategori untuk baris. */
export function entryKindLabelVM(e: EntryVM): string {
  switch (e.kind) {
    case 'opening_balance':
      return 'Saldo awal';
    case 'adjustment':
      return 'Cocokkan saldo';
    case 'transfer':
      return 'Pindah dompet';
    case 'space_transfer':
      return 'Antar ruang';
    case 'reimbursement':
      return 'Reimburse';
    default:
      return e.categoryName ?? 'Tanpa kategori';
  }
}

/** Nominal bertanda dari sudut pandang ruang entri. */
export function signedAmountVM(e: EntryVM): {
  value: Rupiah;
  kind: 'income' | 'expense' | 'neutral';
} {
  switch (e.kind) {
    case 'income':
      return { value: e.amount, kind: 'income' };
    case 'expense':
      return { value: -e.amount, kind: 'expense' };
    case 'space_transfer':
      return { value: e.direction === 'in' ? e.amount : -e.amount, kind: 'neutral' };
    default:
      return { value: e.amount, kind: 'neutral' };
  }
}

/**
 * Efek entri pada satu dompet (riwayat dompet): pengeluaran mengurangi, pemasukan menambah;
 * transfer mengurangi dompet sumber sebesar nominal + biaya dan menambah dompet lawan sebesar
 * nominal; antar ruang keluar mengurangi sebesar nominal + biaya; cocokkan saldo mengikuti
 * `direction`. Entri pembuka (Saldo awal) ditampilkan terpisah.
 */
export function effectOnAccountVM(
  e: EntryVM,
  accountId: string,
): { value: Rupiah; kind: 'income' | 'expense' | 'neutral' } {
  const fee = e.fee ?? 0;
  switch (e.kind) {
    case 'income':
      return { value: e.amount, kind: 'income' };
    case 'expense':
      return { value: -e.amount, kind: 'expense' };
    case 'transfer':
      return {
        value: e.accountId === accountId ? -(e.amount + fee) : e.amount,
        kind: 'neutral',
      };
    case 'space_transfer':
      return {
        value: e.direction === 'out' ? -(e.amount + fee) : e.amount,
        kind: 'neutral',
      };
    case 'adjustment':
      return { value: e.direction === 'out' ? -e.amount : e.amount, kind: 'neutral' };
    default:
      return { value: e.amount, kind: 'neutral' };
  }
}

/**
 * Keterangan biaya di baris riwayat satu dompet (`/[ruang]/dompet/[id]`): tampil pada dompet yang
 * menanggung biaya (dompet pengirim `transfer` atau kaki keluar `space_transfer`).
 */
export function accountFeeNoteVM(e: EntryVM, accountId: string): string | undefined {
  if (e.fee === undefined || e.fee <= 0) return undefined;
  if (
    (e.kind === 'transfer' && e.accountId === accountId) ||
    (e.kind === 'space_transfer' && e.direction === 'out')
  ) {
    return `Biaya ${formatRupiah(e.fee)}`;
  }
  return undefined;
}

/**
 * Keterangan biaya di baris daftar (S8-D1a): hanya kaki keluar Bersama (`Diambil oleh {Nama}`) yang
 * membawa biaya ke daftar; nominal kanan tetap nominal transfer tanpa biaya digabung.
 */
export function feeNoteVM(e: EntryVM): string | undefined {
  if (e.kind !== 'space_transfer' || e.spaceKind !== 'shared' || e.direction !== 'out') {
    return undefined;
  }
  return e.fee === undefined ? undefined : `Biaya ${formatRupiah(e.fee)}`;
}
