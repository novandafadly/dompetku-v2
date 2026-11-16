import { formatRupiah } from '@dompetku/domain';
import type { AssetKind, Ruang } from '@/features/ledger/types';

/**
 * Salinan Aset non-saham (bingkai S14 "Salinan final S14", AS1–AS6). Istilah: `Kekayaan bersih`,
 * `Aset`, `Nilai`; tanpa "net worth", "portfolio", tanpa tanda seru. Nominal hanya disusun dari
 * data yang sudah dimuat; pesan galat DB tidak pernah memuatnya.
 */

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  emas: 'Emas',
  properti: 'Properti',
  kendaraan: 'Kendaraan',
  reksa_dana: 'Reksa dana',
  deposito: 'Deposito',
  saham: 'Saham',
  lainnya: 'Lainnya',
};

/** Urutan di pemilih Jenis aset (Saham hanya Pribadi). */
export const ASSET_KINDS: readonly AssetKind[] = [
  'emas',
  'properti',
  'kendaraan',
  'reksa_dana',
  'deposito',
  'saham',
  'lainnya',
];

const NAME_HINT: Record<AssetKind, string> = {
  emas: 'Misalnya Emas Antam 10 gram.',
  properti: 'Misalnya Rumah Bekasi.',
  kendaraan: 'Misalnya Motor Vario.',
  reksa_dana: 'Misalnya Reksa dana pasar uang.',
  deposito: 'Misalnya Deposito BCA 6 bulan.',
  saham: 'Nama sekuritas, misalnya Ajaib atau Stockbit.',
  lainnya: 'Misalnya Koleksi jam.',
};

export const ASET_COPY = {
  add: 'Tambah aset',
  addTitle: (ruang: Ruang) => `Tambah aset · ${ruang === 'pribadi' ? 'Pribadi' : 'Bersama'}`,
  kindField: 'Jenis aset',
  kindHint: 'Jenis tidak bisa diganti sesudah disimpan.',
  kindPlaceholder: 'Pilih jenis aset',
  nameField: 'Nama',
  nameHint: (kind: AssetKind | '') =>
    kind === '' ? 'Misalnya Emas Antam 10 gram.' : NAME_HINT[kind],
  valueField: 'Nilai sekarang',
  valueHint:
    'Isi bila aset ini sudah kamu punya. Bila baru dibeli dari dompet, kosongkan lalu pakai Isi dari dompet sesudah disimpan, supaya saldo dompetnya ikut turun.',
  valueHintStock: 'Saham diisi sesudah ini lewat Beli saham atau Saham yang sudah dimiliki.',
  sinceField: 'Sejak',
  save: 'Simpan aset',
  added: (name: string, ruang: Ruang) =>
    `Aset ${name} ditambahkan di ${ruang === 'pribadi' ? 'Pribadi' : 'Bersama'}`,

  // Detail aset (AS3)
  valueOf: (name: string) => `Nilai ${name}`,
  noValue: 'Belum ada nilai',
  noValueStock: 'Belum ada saham',
  kindUpdated: (kind: string, on: string) => `${kind} · diperbarui ${on}`,
  kindSince: (kind: string, on: string) => `${kind} · nilai sejak ${on}`,
  revalue: 'Perbarui nilai',
  fill: 'Isi dari dompet',
  withdraw: 'Cairkan ke dompet',
  editOpening: 'Ubah nilai awal',
  notIncome: 'Perubahan nilai tidak dihitung sebagai pemasukan atau pengeluaran.',
  openingLabel: 'Nilai awal',

  // Perbarui nilai (AS4)
  revalueTitle: (name: string, ruang: Ruang) =>
    `Perbarui nilai ${name} · ${ruang === 'pribadi' ? 'Pribadi' : 'Bersama'}`,
  recorded: (value: number, on: string) => `Tercatat ${formatRupiah(value)} per ${on}.`,
  recordedNoDate: (value: number) => `Tercatat ${formatRupiah(value)}.`,
  dateField: 'Tanggal',
  up: (delta: number) => `Naik ${formatRupiah(delta)}`,
  down: (delta: number) => `Turun ${formatRupiah(Math.abs(delta))}`,
  same: 'Nilainya sama, tidak ada yang dicatat.',
  empty: 'Isi nilai sekarang untuk melihat perubahannya.',
  revalueHint:
    'Pakai harga pasar atau taksiran yang wajar. Perubahan nilai tidak masuk Laporan dan anggaran.',
  saveValue: 'Simpan nilai',
  revalued: (name: string) => `Nilai ${name} diperbarui`,
  undo: 'Urungkan',

  // Sheet Transfer berprasetel (AS5)
  fillTitle: (name: string) => `Isi ${name}`,
  withdrawTitle: (name: string) => `Cairkan ${name}`,
  fillNote: 'Bukan pengeluaran. Laporan dan anggaran tidak berubah.',
  withdrawNote: 'Bukan pemasukan.',
  assetOption: (name: string) => `${name} · Aset`,

  // Arsip (AS6)
  archiveBlocked: (name: string) =>
    `${name} masih bernilai. Perbarui nilainya ke 0 atau cairkan ke dompet, lalu arsipkan.`,
  archiveBlockedStock: (name: string) =>
    `${name} masih memegang saham. Jual semua saham dulu, lalu arsipkan.`,
} as const;

/** Rincian hero Kekayaan bersih (NW1). */
export const NW_COPY = {
  title: 'Kekayaan bersih',
  monthAgo: (value: string) => `30 hari lalu ${value}`,
  monthAgoOn: (value: string, on: string) => `${on}: ${value}`,
  kas: 'Kas',
  aset: 'Aset',
  saham: 'Saham',
  piutang: 'Piutang',
  utang: 'Utang',
  priceAsOf: (on: string) => `Harga saham ${on}`,
  missingPrice: 'Sebagian saham belum ada harga, jadi dinilai sebesar biaya beli.',
  subPersonal: 'Kas, aset, saham, dan sisa utang-piutang. Kas Kantor tidak dihitung.',
  subShared: 'Kas, aset, dan saham bersama.',
  subSharedCash: 'Kas Bersama.',
  loadFailed: 'Kekayaan bersih belum bisa dimuat.',
} as const;
