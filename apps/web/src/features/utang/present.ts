import { formatRupiah, type Rupiah } from '@dompetku/domain';
import type { DebtDirection, DebtListItemVM, DebtQuickVM } from './types';

/**
 * Fungsi murni tampilan Utang (S11). Angka uang datang dari SQL; di sini hanya membandingkan,
 * mengurutkan, dan satu pengurangan/penambahan pratinjau (preseden S6-C3/S9-TG3: hasil sesudah
 * simpan selalu dari balasan SQL).
 */

/** Huruf pertama nama (ubin inisial, dekoratif). Kosong = `?`. */
export function initialOf(name: string): string {
  const first = name.trim().codePointAt(0);
  return first === undefined ? '?' : String.fromCodePoint(first).toLocaleUpperCase('id-ID');
}

export interface DebtGroups {
  borrowed: DebtListItemVM[];
  lent: DebtListItemVM[];
  settled: DebtListItemVM[];
  deleted: DebtListItemVM[];
}

const byRemaining = (a: DebtListItemVM, b: DebtListItemVM): number =>
  b.remaining - a.remaining || a.contactName.localeCompare(b.contactName, 'id');

/**
 * Kelompok daftar (UT1): utang hidup bersisa per arah (sisa terbesar, lalu nama), yang lunas, dan
 * yang dihapus (terbaru dulu). Hanya perbandingan, tanpa penjumlahan.
 */
export function groupDebts(debts: readonly DebtListItemVM[]): DebtGroups {
  const live = debts.filter((d) => d.voidedAt === null);
  const open = live.filter((d) => d.remaining > 0);
  return {
    borrowed: open.filter((d) => d.direction === 'borrowed').sort(byRemaining),
    lent: open.filter((d) => d.direction === 'lent').sort(byRemaining),
    settled: live
      .filter((d) => d.remaining === 0)
      .sort((a, b) => a.contactName.localeCompare(b.contactName, 'id')),
    deleted: debts
      .filter((d) => d.voidedAt !== null)
      .sort((a, b) => (b.voidedAt ?? '').localeCompare(a.voidedAt ?? '')),
  };
}

/** `12% terbayar · dari Rp 2.000.000` (baris daftar). */
export function paidCaption(paidPct: number, principal: Rupiah): string {
  return `${String(paidPct)}% terbayar · dari ${formatRupiah(principal)}`;
}

/** Detail: `25% terbayar · Rp 500.000 dari Rp 2.000.000`; lunas: `Rp 2.000.000 terbayar penuh`. */
export function paidCaptionDetail(
  paidPct: number,
  paid: Rupiah,
  principal: Rupiah,
  settled: boolean,
): string {
  if (settled) return `${formatRupiah(principal)} terbayar penuh`;
  // Belum ada cicilan: tidak ada "Rp 0" (bingkai aturan 3).
  if (paid === 0) return `Belum ada pembayaran · dari ${formatRupiah(principal)}`;
  return `${String(paidPct)}% terbayar · ${formatRupiah(paid)} dari ${formatRupiah(principal)}`;
}

export interface QuickOption {
  key: 'p25' | 'p50' | 'full';
  label: string;
  amount: Rupiah;
  /** `25% dari sisa, Rp 375.000` (Label in Name). */
  ariaLabel: string;
}

/**
 * Pintasan jumlah Bayar (BY1): 25% dan 50% dari SISA bila hasilnya > 0 dan kurang dari sisa
 * (`null` dari SQL = disembunyikan, tidak pernah "Rp 0"), lalu `Lunas` = sisa. Sisa 0 = tanpa chip.
 */
export function quickOptions(q: DebtQuickVM): QuickOption[] {
  if (q.full <= 0) return [];
  const out: QuickOption[] = [];
  const part = (key: 'p25' | 'p50', label: string, v: Rupiah | null) => {
    if (v !== null && v > 0 && v < q.full) {
      out.push({ key, label, amount: v, ariaLabel: `${label} dari sisa, ${formatRupiah(v)}` });
    }
  };
  part('p25', '25%', q.p25);
  part('p50', '50%', q.p50);
  out.push({
    key: 'full',
    label: 'Lunas',
    amount: q.full,
    ariaLabel: `Lunas, ${formatRupiah(q.full)}`,
  });
  return out;
}

/** Chip terpilih = jumlah di kolom sama persis dengan nilainya (diturunkan, bukan state ganda). */
export function selectedQuick(
  options: readonly QuickOption[],
  amount: Rupiah | null,
): QuickOption['key'] | null {
  if (amount === null) return null;
  return options.find((o) => o.amount === amount)?.key ?? null;
}

/** Teks tombol footer Bayar: nominal mengikuti isian; jumlah = sisa menjadi pelunasan. */
export function payFooterLabel(
  direction: DebtDirection,
  amount: Rupiah | null,
  remaining: Rupiah,
): string {
  const verb = direction === 'lent' ? 'Terima' : 'Bayar';
  if (amount === null || amount <= 0) return verb;
  if (amount === remaining) {
    return direction === 'lent'
      ? `Terima pelunasan ${formatRupiah(amount)}`
      : `Lunasi ${formatRupiah(amount)}`;
  }
  return `${verb} ${formatRupiah(amount)}`;
}

/** Pratinjau sesudah bayar: sisa dan saldo (satu pengurangan/penambahan; SQL yang memutuskan). */
export function payPreview(
  direction: DebtDirection,
  amount: Rupiah,
  remaining: Rupiah,
  balance: Rupiah,
): { remainingAfter: Rupiah; walletAfter: Rupiah; walletDelta: Rupiah } {
  const walletDelta = direction === 'lent' ? amount : -amount;
  return { remainingAfter: remaining - amount, walletAfter: balance + walletDelta, walletDelta };
}

/** Pratinjau membatalkan pembayaran: sisa bertambah, saldo kembali (Utang) atau keluar lagi (Piutang). */
export function cancelPreview(
  direction: DebtDirection,
  amount: Rupiah,
  remaining: Rupiah,
  balance: Rupiah,
): { remainingAfter: Rupiah; walletAfter: Rupiah; walletDelta: Rupiah } {
  const walletDelta = direction === 'lent' ? -amount : amount;
  return { remainingAfter: remaining + amount, walletAfter: balance + walletDelta, walletDelta };
}

/** Pratinjau Tambah (mode baru): Utang = uang masuk (+), Piutang = uang keluar (−). */
export function addPreview(
  direction: DebtDirection,
  amount: Rupiah,
  balance: Rupiah,
): { walletAfter: Rupiah; walletDelta: Rupiah } {
  const walletDelta = direction === 'lent' ? -amount : amount;
  return { walletAfter: balance + walletDelta, walletDelta };
}

/** `Saldo BCA berkurang Rp 375.000` / `bertambah`. */
export function walletChangeNote(account: string, walletDelta: Rupiah): string {
  return `Saldo ${account} ${walletDelta < 0 ? 'berkurang' : 'bertambah'} ${formatRupiah(Math.abs(walletDelta))}`;
}
