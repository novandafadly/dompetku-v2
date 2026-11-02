import type { Rupiah } from '@dompetku/domain';
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
    case 'space_transfer':
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
 * transfer mengurangi dompet sumber (baris utama) dan menambah dompet lawan; antar ruang dan
 * cocokkan saldo mengikuti `direction`. Entri pembuka (Saldo awal) ditampilkan terpisah.
 */
export function effectOnAccountVM(
  e: EntryVM,
  accountId: string,
): { value: Rupiah; kind: 'income' | 'expense' | 'neutral' } {
  switch (e.kind) {
    case 'income':
      return { value: e.amount, kind: 'income' };
    case 'expense':
      return { value: -e.amount, kind: 'expense' };
    case 'transfer':
      return { value: e.accountId === accountId ? -e.amount : e.amount, kind: 'neutral' };
    case 'space_transfer':
    case 'adjustment':
      return { value: e.direction === 'out' ? -e.amount : e.amount, kind: 'neutral' };
    default:
      return { value: e.amount, kind: 'neutral' };
  }
}
