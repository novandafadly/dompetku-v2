// Bagian selectors demo; satu berkas per kelompok pemakai supaya rute hanya memuat yang dipakai
// (paket bebas efek samping, ADR 0002).
import type { DemoState, Entry } from '../types';

/** Nada nominal: pemasukan, pengeluaran, atau netral (transfer dan saldo awal). */
export type AmountKind = 'income' | 'expense' | 'neutral';

/** Judul entri di daftar: deskripsi, lalu catatan bersama, lalu nama kategori. */
export function entryTitle(state: DemoState, e: Entry): string {
  switch (e.kind) {
    case 'opening_balance':
      return 'Saldo awal';
    case 'transfer':
      return e.description ?? 'Pindah dompet';
    case 'space_transfer':
      return (
        e.sharedNote ??
        e.description ??
        (e.direction === 'in' ? 'Setoran dari Pribadi' : 'Setoran ke Bersama')
      );
    default:
      return (
        e.description ??
        state.categories.find((c) => c.id === e.categoryId)?.name ??
        'Tanpa kategori'
      );
  }
}

/** Label jenis/kategori entri untuk baris: kategori, atau Saldo awal / Pindah dompet / Antar ruang. */
export function entryKindLabel(state: DemoState, e: Entry): string {
  switch (e.kind) {
    case 'opening_balance':
      return 'Saldo awal';
    case 'transfer':
      return 'Pindah dompet';
    case 'space_transfer':
      return 'Antar ruang';
    default:
      return state.categories.find((c) => c.id === e.categoryId)?.name ?? 'Tanpa kategori';
  }
}

/** Nama kategori entri (untuk ikon), bila ada. */
export function entryCategoryName(state: DemoState, e: Entry): string | undefined {
  return state.categories.find((c) => c.id === e.categoryId)?.name;
}

/** Nominal bertanda dari sudut pandang ruang entri: pengeluaran dan setoran keluar negatif. */
export function signedAmount(e: Entry): { value: number; kind: AmountKind } {
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
