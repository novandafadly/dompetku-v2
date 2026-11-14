import { formatRupiah, type Rupiah } from '@dompetku/domain';
import type { EntryVM } from './types';

/**
 * Arah utang sebuah entri pokok/cicilan: dari utangnya bila dimuat, selain itu dari arah uang di
 * dompet (pokok masuk = pinjam, pokok keluar = pinjamkan; cicilan keluar = bayar utang, cicilan
 * masuk = terima piutang).
 */
function debtDirectionOf(e: EntryVM): 'borrowed' | 'lent' {
  if (e.debt !== undefined) return e.debt.direction;
  const moneyIn = e.direction === 'in';
  if (e.kind === 'debt_principal') return moneyIn ? 'borrowed' : 'lent';
  return moneyIn ? 'lent' : 'borrowed';
}

/** Label jenis pokok/cicilan utang menurut arah (S11). */
function debtKindLabel(e: EntryVM): string {
  const borrowed = debtDirectionOf(e) === 'borrowed';
  if (e.kind === 'debt_principal') return borrowed ? 'Pinjaman diterima' : 'Pinjaman diberikan';
  return borrowed ? 'Pembayaran utang' : 'Penerimaan piutang';
}

/** Judul kaki Pribadi bagi tagihan (S12-PT, bingkai `Label transaksi`). */
const SPLIT_LEG_TITLE = {
  bill: 'Bayar untuk Bersama',
  settle: 'Lunasi patungan',
  receive: 'Terima patungan',
} as const;

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
    case 'debt_principal':
    case 'debt_payment':
      // S11: nama kontak (+ judul utang bila ada); tanpa utang dimuat jatuh ke label jenis.
      return e.debt === undefined
        ? debtKindLabel(e)
        : e.debt.title === undefined
          ? e.debt.contactName
          : `${e.debt.contactName} · ${e.debt.title}`;
    case 'space_transfer':
      // S12: kaki Pribadi bagi tagihan; judul tetap (deskripsi tagihan hanya di Bersama).
      if (e.split !== undefined) return SPLIT_LEG_TITLE[e.split.role];
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
      return e.split === undefined ? 'Antar ruang' : 'Patungan';
    case 'reimbursement':
      return 'Reimburse';
    case 'debt_principal':
    case 'debt_payment':
      return debtKindLabel(e);
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
    case 'debt_principal':
    case 'debt_payment':
      return { value: e.direction === 'in' ? e.amount : -e.amount, kind: 'neutral' };
    default:
      return { value: e.amount, kind: 'neutral' };
  }
}

/**
 * Efek entri pada satu dompet (riwayat dompet): pengeluaran mengurangi, pemasukan menambah;
 * transfer mengurangi dompet sumber sebesar nominal + biaya dan menambah dompet lawan sebesar
 * nominal; antar ruang keluar mengurangi sebesar nominal + biaya; cocokkan saldo mengikuti
 * `direction`, begitu juga pokok dan cicilan utang/piutang. Entri pembuka (Saldo awal) ditampilkan
 * terpisah.
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
    // S11: pokok/cicilan utang dan piutang seperti cocokkan saldo, arah dari tanda baris utama.
    case 'adjustment':
    case 'debt_principal':
    case 'debt_payment':
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
