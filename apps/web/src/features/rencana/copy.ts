import type { PeriodVM, Ruang } from '@/features/ledger/types';
import type { BudgetOverviewVM } from './types';

/**
 * Salinan dan fungsi murni Rencana (S9; bingkai `docs/design/s9-bingkai.md`, "Salinan final S9" dan
 * "Salinan galat S9"). Tanpa `'use client'` dan tanpa impor klien: dipakai Server Component dan
 * pulau klien. Nominal tidak pernah ada di pesan galat; nama tagihan/kategori berasal dari data
 * ruang itu sendiri.
 */

/** Batas nominal (Zod `rencana.ts` dan DB): lebih dari ini = `Nominal terlalu besar`. */
export const MAX_AMOUNT = 10 ** 13;

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

/** Ambang `hampir habis`/peringatan: terpakai ≥ 80% (dipakai Rencana dan kartu Beranda). */
export const NEAR_PCT = 80;

export type BudgetLevel = 'ok' | 'near' | 'full' | 'over';

/** Tangga status anggaran (ikon + teks, bukan warna saja): ≥ 80% hati-hati, 100% penuh, > 100% lewat. */
export function budgetLevel(row: Pick<BudgetOverviewVM, 'pct' | 'remaining'>): BudgetLevel {
  if (row.remaining !== null && row.remaining < 0) return 'over';
  if (row.remaining === 0) return 'full';
  return (row.pct ?? 0) >= NEAR_PCT ? 'near' : 'ok';
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

/**
 * Salinan Tagihan (S9-TG1…TG3; bingkai "Salinan final S9" dan "Salinan galat S9"). Nominal tidak
 * pernah ada di pesan galat; nama tagihan/kategori/dompet berasal dari data ruang itu sendiri.
 */
export const TAGIHAN_COPY = {
  overdue: 'Lewat jatuh tempo',
  thisPeriod: 'Periode ini',
  next: 'Berikutnya',
  archived: (n: number) => `Tagihan diarsipkan (${String(n)})`,
  add: 'Tambah tagihan',
  pay: 'Bayar',
  unskip: 'Batalkan lewati',
  /** Tagihan aktif tanpa kemunculan terlihat: sub baris. */
  everyMonth: (day: number) => `Tiap tanggal ${String(day)}`,
  // Sheet Tambah/Ubah (TG2)
  sheetTitle: (ruang: Ruang) => `Tagihan · ${RUANG_NAME[ruang]}`,
  sheetEditTitle: (ruang: Ruang) => `Ubah tagihan · ${RUANG_NAME[ruang]}`,
  name: 'Nama',
  amount: 'Perkiraan nominal',
  amountHint: 'Bisa diubah saat membayar.',
  category: 'Kategori',
  pickCategory: 'Pilih kategori',
  account: 'Dompet bayar bawaan',
  pickAtPay: 'Pilih saat membayar',
  day: 'Tanggal tiap bulan',
  dayHint: 'Tanggal 29–31 jatuh ke hari terakhir bulan pendek.',
  startsOn: 'Mulai',
  startsOnPast: (bulan: string) => `Bulan sebelum ${bulan} tidak ditagih.`,
  startedOn: (tgl: string) => `Mulai ${tgl}`,
  endsOn: 'Berakhir',
  endsOnHint: 'Kosongkan bila tidak ada batas.',
  editNote: 'Berlaku untuk tagihan yang belum dibayar mulai hari ini.',
  save: 'Simpan tagihan',
  archive: 'Arsipkan tagihan',
  back: 'Kembali',
  archiveTitle: (nama: string) => `Arsipkan tagihan ${nama}?`,
  archiveBody:
    'Tagihan berhenti ditagih mulai sekarang dan tidak bisa diaktifkan lagi. Yang sudah dibayar tetap tercatat.',
  saved: (nama: string, ruang: Ruang) => `Tagihan ${nama} disimpan · ${RUANG_NAME[ruang]}`,
  archivedToast: (nama: string, ruang: Ruang) =>
    `Tagihan ${nama} diarsipkan · ${RUANG_NAME[ruang]}`,
  // Sheet Bayar (TG3)
  payTitle: (nama: string, ruang: Ruang) => `Bayar ${nama} · ${RUANG_NAME[ruang]}`,
  dueOn: (tgl: string) => `Jatuh tempo ${tgl}`,
  lateDays: (n: number) => `Lewat ${String(n)} hari`,
  payAmount: 'Nominal',
  estimate: (rp: string) => `Perkiraan ${rp}`,
  payAccount: 'Dompet',
  payDate: 'Tanggal bayar',
  payButton: (rp: string | null) => (rp === null ? 'Bayar' : `Bayar ${rp}`),
  payAnyway: 'Tetap bayar',
  skip: 'Lewati tagihan ini',
  skipHint: 'Pilih ini bila tagihan sudah dibayar di luar aplikasi.',
  paid: (nama: string, ruang: Ruang, rp: string, dompet: string) =>
    `Tagihan ${nama} dibayar di ${RUANG_NAME[ruang]} · ${rp} dari ${dompet}`,
  skipped: (nama: string, ruang: Ruang) => `${nama} dilewati · ${RUANG_NAME[ruang]}`,
  unskipped: (nama: string, ruang: Ruang) => `${nama} kembali ditagih · ${RUANG_NAME[ruang]}`,
  undo: 'Urungkan',
  undoFailed: 'Belum bisa diurungkan. Buka Transaksi untuk membatalkan pembayarannya.',
  undoSkipFailed: 'Belum bisa diurungkan. Coba lagi dari Rencana.',
  noAccount: (ruang: Ruang) =>
    `Belum ada dompet di ${RUANG_NAME[ruang]}. Tambah dompet dulu untuk membayar.`,
  addAccount: 'Tambah dompet',
  // Galat
  errName: 'Nama tagihan wajib diisi, paling banyak 60 huruf.',
  errAmount: 'Nominal harus lebih dari nol.',
  archivedAccount: (dompet: string) =>
    `Dompet bawaan ${dompet} sudah diarsipkan. Pilih dompet lain atau biarkan kosong.`,
  errAmountMax: 'Nominal terlalu besar. Maksimal Rp 10.000.000.000.000.',
  errDay: 'Pilih tanggal 1 sampai 31.',
  errEndsOn: 'Tanggal berakhir tidak boleh sebelum tanggal mulai.',
  errStartsOn: 'Isi tanggal mulai.',
  errCategory: 'Pilih kategori pengeluaran.',
  errKantor: 'Dompet Kantor tidak bisa dipakai untuk tagihan. Pilih dompet lain.',
  errPickAccount: 'Pilih dompet.',
  errAlreadyPosted: 'Tagihan ini sudah dibayar.',
  reload: 'Muat ulang',
  errBillGone: 'Tagihan ini sudah tidak ada. Tutup lalu buka Rencana lagi.',
  errBillArchived: 'Tagihan ini sudah diarsipkan.',
  errIdem:
    'Pembayaran ini sudah pernah terkirim dengan isi berbeda. Periksa riwayat Transaksi sebelum membayar lagi.',
  errInvalid: 'Isian belum lengkap. Periksa lagi lalu simpan.',
  errNetwork:
    'Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan mencatat dua kali.',
  errServer: 'Belum tersimpan. Ada kendala di server. Coba lagi tidak akan mencatat dua kali.',
  errArchiveGone: 'Tagihan ini sudah tidak ada. Muat ulang halaman.',
  errArchiveArchived: 'Tagihan ini sudah diarsipkan. Muat ulang halaman.',
  errArchiveNetwork: 'Belum diarsipkan. Koneksi terputus saat mengirim. Coba lagi.',
  errArchiveServer: 'Belum diarsipkan. Ada kendala di server. Coba lagi.',
  errUnskip: 'Belum bisa dibatalkan. Coba lagi.',
  errSkipNetwork: 'Belum terlewati. Koneksi terputus saat mengirim. Coba lagi.',
  errSkipServer: 'Belum terlewati. Ada kendala di server. Coba lagi.',
} as const;

/** `obligation_double` di sheet Tagihan: kategori (atau induknya) sudah punya anggaran wajib. */
export function obligationDoubleBillText(kategori: string, wajibRoot: string | null): string {
  const tail =
    'Satu kewajiban cukup dicatat sekali: jadikan anggarannya tidak wajib atau pilih kategori lain.';
  return wajibRoot === null || wajibRoot === kategori
    ? `Kategori ${kategori} sudah punya anggaran wajib. ${tail}`
    : `Anggaran wajib ${wajibRoot} sudah mencakup ${kategori}. ${tail}`;
}

export function accountArchivedBillText(dompet: string): string {
  return `${dompet} sudah diarsipkan. Pilih dompet lain.`;
}

/** Peringatan saldo kurang sebelum bayar (S9-TG3; nominal sah: bukan pesan galat server). */
export function saldoKurangBayarText(dompet: string, balance: string, after: string): string {
  return `Saldo ${dompet} tinggal ${balance}. Kalau dibayar, saldonya jadi ${after}.`;
}
