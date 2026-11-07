import type { PeriodVM, Ruang } from '@/features/ledger/types';
import type { BudgetOverviewVM } from './types';

/**
 * Salinan dan fungsi murni Rencana (S9; bingkai `docs/design/s9-bingkai.md`, "Salinan final S9" dan
 * "Salinan galat S9"). Tanpa `'use client'` dan tanpa impor klien: dipakai Server Component dan
 * pulau klien. Nominal tidak pernah ada di pesan galat; nama tagihan/kategori berasal dari data
 * ruang itu sendiri.
 */

export const RUANG_NAME: Record<Ruang, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };

export const RENCANA_COPY = {
  failedTitle: 'Rencana belum bisa dimuat.',
  failedDescription: 'Periksa koneksi lalu coba lagi.',
  emptyTitle: (ruang: Ruang) => `Belum ada rencana di ${RUANG_NAME[ruang]}.`,
  emptyDescription:
    'Atur anggaran per kategori atau tambah tagihan rutin. Tagihan dan anggaran wajib ikut menghitung aman dipakai di Beranda.',
  emptyBudgetTitle: 'Belum ada anggaran.',
  emptyBudgetDescription: 'Batasi pengeluaran per kategori dan lihat sisanya kapan saja.',
  emptyBillTitle: 'Belum ada tagihan.',
  emptyBillDescription:
    'Catat tagihan rutin supaya tidak terlewat dan ikut dihitung di aman dipakai.',
  setFirst: 'Atur anggaran pertama',
  set: 'Atur anggaran',
  copy: 'Salin anggaran periode lalu',
  newPeriod: (n: number) =>
    `Periode ini belum punya anggaran. Periode lalu ada ${String(n)} anggaran.`,
  newPeriodWajib:
    'Anggaran wajib periode lalu belum ikut menghitung aman dipakai sampai diatur lagi.',
  copyConflict: (k: number) =>
    `${String(k)} anggaran wajib tidak disalin karena kategorinya sudah punya tagihan.`,
  copied: (n: number, ruang: Ruang, skipped: number) =>
    `${String(n)} anggaran disalin ke ${RUANG_NAME[ruang]}${
      skipped > 0 ? ` · ${String(skipped)} dilewati` : ''
    }`,
  copyNothing: (ruang: Ruang) => `Tidak ada anggaran yang disalin ke ${RUANG_NAME[ruang]}`,
  used: 'Terpakai',
  budgeted: 'Dianggarkan',
  unbudgeted: 'Belum dianggarkan',
  noSpend: 'Belum ada pengeluaran',
  /** Bingkai AN2. */
  sheetTitle: (ruang: Ruang) => `Anggaran · ${RUANG_NAME[ruang]}`,
  category: 'Kategori',
  amount: 'Anggaran periode ini',
  wajib: 'Wajib',
  wajibHint: 'Dipotong dari aman dipakai sampai terpakai.',
  save: 'Simpan anggaran',
  remove: 'Hapus anggaran',
  back: 'Kembali',
  allBudgeted: 'Semua kategori sudah punya anggaran.',
  pickCategory: 'Pilih kategori',
  archivedNote: 'Kategori ini sudah diarsipkan. Anggarannya masih bisa dihapus.',
  removeTitle: (kategori: string) => `Hapus anggaran ${kategori}?`,
  removeBody: 'Pengeluaran kategori ini tetap tercatat. Hanya batasnya yang dihapus.',
  saved: (kategori: string, ruang: Ruang) => `Anggaran ${kategori} disimpan · ${RUANG_NAME[ruang]}`,
  removed: (kategori: string, ruang: Ruang) =>
    `Anggaran ${kategori} dihapus · ${RUANG_NAME[ruang]}`,
  /** Galat (bingkai "Salinan galat S9"). */
  errAmount: 'Nominal harus lebih dari nol.',
  errCategory: 'Pilih kategori pengeluaran.',
  errNotRoot: 'Kategori ini sudah bukan kategori induk. Tutup lalu buka Rencana lagi.',
  errGone: 'Kategori ini sudah tidak ada. Tutup lalu buka Rencana lagi.',
  errInvalid: 'Isian belum lengkap. Periksa lagi lalu simpan.',
  errNetwork:
    'Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan mencatat dua kali.',
  errServer: 'Belum tersimpan. Ada kendala di server. Coba lagi tidak akan mencatat dua kali.',
  errRemoveNetwork: 'Belum terhapus. Koneksi terputus saat mengirim. Coba lagi.',
  errRemoveServer: 'Belum terhapus. Ada kendala di server. Coba lagi.',
  errCopyNetwork:
    'Belum tersalin. Koneksi terputus saat mengirim. Coba lagi tidak akan menyalin dua kali.',
  errCopyServer: 'Belum tersalin. Ada kendala di server. Coba lagi tidak akan menyalin dua kali.',
  errCopyNothing: 'Tidak ada anggaran periode lalu yang bisa disalin.',
} as const;

/** Anggaran bentrok dengan tagihan aktif di kategori yang sama (arah: sakelar Wajib). */
export function obligationDoubleBudgetText(billName: string | undefined): string {
  const bill = billName === undefined ? 'tagihan' : `tagihan ${billName}`;
  return `Kategori ini sudah punya ${bill}. Satu kewajiban cukup dicatat sekali: arsipkan tagihannya atau jadikan anggaran ini tidak wajib.`;
}

export function categoryArchivedBudgetText(kategori: string): string {
  return `${kategori} sudah diarsipkan. Pilih kategori lain.`;
}

/** `November 2026 · 23 Okt – 24 Nov` → judul periode dan rentang tanggal. */
export function splitPeriodLabel(label: string): { title: string; range: string } {
  const i = label.indexOf(' · ');
  return i < 0
    ? { title: label, range: '' }
    : { title: label.slice(0, i), range: label.slice(i + 3) };
}

/** `23 Okt – 24 Nov · berjalan, 20 hari lagi`. */
export function periodSubtitle(period: PeriodVM): string {
  const { range } = splitPeriodLabel(period.label);
  const left = `berjalan, ${String(period.daysLeft)} hari lagi`;
  return range === '' ? left : `${range} · ${left}`;
}

export type BudgetLevel = 'ok' | 'near' | 'full' | 'over';

/** Tangga status anggaran (ikon + teks, bukan warna saja): ≥ 80% hati-hati, 100% penuh, > 100% lewat. */
export function budgetLevel(row: Pick<BudgetOverviewVM, 'pct' | 'remaining'>): BudgetLevel {
  if (row.remaining !== null && row.remaining < 0) return 'over';
  if (row.remaining === 0) return 'full';
  return (row.pct ?? 0) >= 80 ? 'near' : 'ok';
}

/** Anggaran terisi, urut persentase terbesar lalu nama (bingkai AN1). */
export function budgetedRows(rows: readonly BudgetOverviewVM[]): BudgetOverviewVM[] {
  return rows
    .filter((r) => r.budget !== null)
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0) || a.name.localeCompare(b.name, 'id'));
}

/** Kategori induk aktif tanpa anggaran (urutan SQL). */
export function unbudgetedRows(rows: readonly BudgetOverviewVM[]): BudgetOverviewVM[] {
  return rows.filter((r) => r.budget === null && !r.archived);
}
