import { formatRupiah, shortDateLabel, type IsoDate, type Rupiah } from '@dompetku/domain';
import type { Ruang } from '@/features/ledger/types';
import { rangeLabel } from '@/features/ledger/trip-present';

/**
 * Salinan final S15 (mengikat dari `docs/design/s15-bingkai.md`).
 * Istilah wajib: Trip, Masukkan, Keluarkan dari trip, Arsipkan, Pulihkan, Dicatat oleh,
 * Anggaran trip, Sisa Rp …, Lebih Rp ….
 * Terlarang: boncos, surplus, Liburan (istilah produk), budget, grup, tag, label, rumah tangga, `!`.
 */

const RUANG_NAME: Record<Ruang, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };

export const TRIP_COPY = {
  // TR1–TR4: Menu & daftar
  title: 'Trip',
  pageTitle: (ruang: Ruang) => `Trip · ${RUANG_NAME[ruang]}`,
  add: 'Tambah trip',
  phaseOngoing: 'Berlangsung',
  phaseUpcoming: 'Akan datang',
  phaseEnded: 'Selesai',
  phaseArchived: 'Diarsipkan',
  archivedGroup: (n: number) => `Trip diarsipkan (${String(n)})`,
  days: (n: number) => `${String(n)} hari`,
  expenseCount: (n: number) => `${String(n)} pengeluaran`,
  noExpenses: 'Belum ada pengeluaran',
  remaining: (amount: Rupiah) => `Sisa ${formatRupiah(amount)}`,
  over: (amount: Rupiah) => `Lebih ${formatRupiah(amount)}`,
  emptyTitle: 'Belum ada trip.',
  emptyDescription:
    'Kelompokkan pengeluaran perjalanan, lihat totalnya, dan bandingkan dengan anggaran.',
  noActiveTrips: 'Tidak ada trip aktif.',
  loading: 'Memuat trip…',
  failedTitle: 'Trip belum bisa dimuat.',
  failedDescription: 'Sambungan ke server terputus. Catatan yang sudah tersimpan tidak hilang.',
  detailFailedTitle: 'Trip ini belum bisa dimuat.',
  restore: 'Pulihkan',
  restoreLabel: (name: string) => `Pulihkan trip ${name}`,

  // TR5–TR7: Detail hero, anggaran, rincian
  totalLabel: 'Total pengeluaran',
  noTripExpenses: 'Belum ada pengeluaran di trip ini',
  perDay: (amount: Rupiah) => `Rata-rata ${formatRupiah(amount)} per hari`,
  ongoingProgress: (elapsed: number, total: number) =>
    `hari ke ${String(elapsed)} dari ${String(total)}`,
  upcomingStart: (date: IsoDate) => `mulai ${shortDateLabel(date)}`,
  edit: 'Ubah trip',
  archive: 'Arsipkan',
  budgetTitle: 'Anggaran trip',
  budgetNote: 'Hanya pembanding. Tidak mengubah anggaran bulanan.',
  pct: (p: number) => `${String(p)}%`,
  belowOne: 'Kurang dari 1%',
  addBudget: 'Tambah anggaran trip',
  progressText: (pct: number, spent: Rupiah, budget: Rupiah, budgetLeft: Rupiah) => {
    const pctWord = spent > 0 && pct === 0 ? 'Kurang dari 1 persen' : `${String(pct)} persen`;
    return budgetLeft < 0
      ? `${pctWord} dari anggaran trip, ${formatRupiah(spent)} dari ${formatRupiah(budget)}, lebih ${formatRupiah(-budgetLeft)}`
      : `${pctWord} dari anggaran trip, ${formatRupiah(spent)} dari ${formatRupiah(budget)}`;
  },
  byCategory: 'Per kategori',
  byDay: (n: number) => `Per hari (${String(n)} hari)`,
  byMember: 'Dicatat oleh',
  me: 'Kamu',
  otherMember: 'Anggota lain',
  uncategorized: 'Tanpa kategori',
  outsideDates: 'Di luar tanggal trip',

  // TR8–TR10: Pengeluaran, Keluarkan, Masukkan, terarsip
  entriesTitle: 'Pengeluaran',
  removeEntryLabel: (title: string) => `Keluarkan dari trip: ${title}`,
  removedToast: (title: string, tripName: string) => `${title} dikeluarkan dari ${tripName}`,
  undo: 'Urungkan',
  fromSplit: 'Dari patungan',
  truncatedNote:
    'Menampilkan 200 pengeluaran terbaru. Rincian di atas dihitung dari semua pengeluaran trip.',
  candidatesTitle: 'Pengeluaran tanggal trip yang belum masuk',
  candidatesSummary: (n: number, startsOn: IsoDate, endsOn: IsoDate) =>
    `${String(n)} pengeluaran bertanggal ${rangeLabel(startsOn, endsOn)} belum masuk trip mana pun.`,
  importButton: (n: number) => `Masukkan ${String(n)} pengeluaran`,
  candidatesMore: 'Masih ada yang lain. Ulangi sesudah ini.',
  importSheetTitle: (tripName: string, ruang: Ruang) =>
    `Masukkan ke ${tripName} · ${RUANG_NAME[ruang]}`,
  importSheetHeading: (tripName: string) => `Masukkan ke ${tripName}`,
  importSheetNote:
    'Pengeluaran Kantor dan talangan tidak ikut. Kamu bisa mengeluarkan satu per satu sesudahnya.',
  importing: 'Memasukkan…',
  cancel: 'Batal',
  importedToast: (n: number, tripName: string) =>
    `${String(n)} pengeluaran dimasukkan ke ${tripName}`,
  emptyDetailHint:
    'Catat pengeluaran dengan tanggal di rentang trip, dan trip ini terpilih otomatis di Catat.',
  archivedBannerTitle: 'Trip ini diarsipkan.',
  archivedBannerBody: 'Pulihkan supaya bisa dipilih lagi di Catat.',

  // TR11–TR13: Sheet Tambah/Ubah & Arsip/Pulihkan
  addTitle: 'Tambah trip',
  editTitle: 'Ubah trip',
  sheetTitle: (base: string, ruang: Ruang) => `${base} · ${RUANG_NAME[ruang]}`,
  nameField: 'Nama trip',
  nameHint: 'Misalnya Bali, Desember 2026.',
  nameLeft: (n: number) => `Sisa ${String(n)} huruf.`,
  startsOnField: 'Mulai',
  endsOnField: 'Selesai',
  budgetField: 'Anggaran trip (opsional)',
  budgetSheetHint:
    'Hanya pembanding di halaman trip. Tidak mengubah anggaran bulanan atau Laporan.',
  clearBudget: 'Hapus anggaran',
  editDatesNote: 'Mengubah tanggal tidak memindahkan pengeluaran yang sudah masuk trip.',
  save: 'Simpan trip',
  saveChanges: 'Simpan perubahan',
  saving: 'Menyimpan…',
  createdToast: (name: string, ruang: Ruang) => `Trip ${name} dibuat di ${RUANG_NAME[ruang]}`,
  updatedToast: (name: string, ruang: Ruang) => `Trip ${name} diperbarui di ${RUANG_NAME[ruang]}`,
  archiveTitle: (name: string) => `Arsipkan ${name}?`,
  archiveBody:
    'Trip hilang dari pilihan di Catat dan dari daftar utama. Pengeluarannya tetap tercatat dan total trip tidak berubah. Kamu bisa memulihkannya dari Trip diarsipkan.',
  archiveShared: (partnerName: string) => `Trip ini juga hilang dari pilihan ${partnerName}.`,
  back: 'Kembali',
  retry: 'Coba lagi',
  archivedToast: (name: string) => `Trip ${name} diarsipkan`,
  restoredToast: (name: string) => `Trip ${name} aktif lagi`,
} as const;
