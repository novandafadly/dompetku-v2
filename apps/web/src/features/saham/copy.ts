import { formatRupiah, shortDateLabel, type IsoDate, type Rupiah } from '@dompetku/domain';
import type { StockHoldingVM } from './types';

/**
 * Salinan saham (bingkai S14 "Salinan final S14", SH1–SH9). Istilah: `Saham`, `Harga`, `Nilai pasar`,
 * `Biaya beli`, `Harga rata-rata`, `Untung`/`Rugi`, `lot`/`lembar`. Tanpa "Portfolio", "P/L",
 * "holding", "ticker", "unrealized", tanpa tanda seru. Nominal hanya disusun dari data yang sudah
 * dimuat; pesan galat DB tidak pernah memuatnya.
 */

/** 1 lot = 100 lembar (aturan BEI). Konversi tampilan, bukan hitungan uang. */
export const LOT = 100;

/** `300 lembar · 3 lot` (habis dibagi 100) atau `250 lembar` (odd lot, tanpa pecahan lot). */
export function sharesLabel(shares: number): string {
  const n = String(shares).replace(/\B(?=(\d{3})+$)/g, '.');
  return shares % LOT === 0 ? `${n} lembar · ${groupLot(shares / LOT)} lot` : `${n} lembar`;
}

const groupLot = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, '.');

/** Jumlah dalam kalimat: `2 lot` bila habis dibagi 100, selain itu `250 lembar`. */
export function sharesShort(shares: number): string {
  return shares % LOT === 0 ? `${groupLot(shares / LOT)} lot` : `${groupLot(shares)} lembar`;
}

/** `+Rp 195.000 untung` / `−Rp 120.000 rugi` / `Impas`: selalu dengan kata, netral tanpa warna. */
export function gainText(n: Rupiah): string {
  if (n === 0) return 'Impas';
  return n > 0 ? `${formatRupiah(n, { sign: 'always' })} untung` : `${formatRupiah(n)} rugi`;
}

/** Bacaan layar: tanda diganti kata (`ditambah`/`dikurangi`), bukan simbol. */
export function gainSpoken(n: Rupiah): string {
  if (n === 0) return 'Impas';
  return n > 0
    ? `ditambah ${formatRupiah(n)} untung`
    : `dikurangi ${formatRupiah(Math.abs(n))} rugi`;
}

export const SAHAM_COPY = {
  // Kartu saldo (SH1)
  marketOf: (name: string) => `Nilai pasar ${name}`,
  costOf: (name: string) => `Biaya beli ${name}`,
  noStock: 'Belum ada saham',
  cost: (value: Rupiah) => `Biaya beli ${formatRupiah(value)}`,
  unrealizedGain: (n: Rupiah) =>
    n === 0 ? 'Belum terealisasi impas' : `Belum terealisasi ${gainText(n)}`,
  realizedGain: (n: Rupiah) => `Sudah terealisasi ${gainText(n)}`,
  priceDate: (on: IsoDate) => `Harga ${shortDateLabel(on)}`,
  someMissing: 'Sebagian saham belum ada harga, dinilai sebesar biaya beli.',
  someHeld: 'Ada harga yang perlu dicek.',
  someStale: 'Ada harga lama.',
  buy: 'Beli saham',
  sell: 'Jual saham',
  setPrice: 'Isi harga',
  open: 'Saham yang sudah dimiliki',
  brokerNote: 'Biaya broker masuk ke biaya beli. Untung atau rugi tidak masuk Laporan.',

  // Daftar (SH1, SH2)
  listTitle: 'Saham',
  soldOut: (n: number) => `Sudah dijual habis (${String(n)})`,
  emptyTitle: (name: string) => `Belum ada saham di ${name}.`,
  emptyBody:
    'Catat pembelian baru, atau masukkan saham yang sudah kamu punya sebelum memakai DompetKu.',
  loadFailed: 'Saham belum bisa dimuat.',
  avg: (value: Rupiah) => `Rata-rata ${formatRupiah(value)}`,
  priceMeta: (value: Rupiah, on: IsoDate) => `Harga ${formatRupiah(value)} · ${shortDateLabel(on)}`,
  noPrice: 'Belum ada harga',
  asCost: 'sebesar biaya beli',
  stale: 'Harga lama',
  staleHint: 'Isi harga terbaru.',
  held: 'Harga perlu dicek',
  heldHint: (heldOn: IsoDate, usedOn: IsoDate | null) =>
    usedOn === null
      ? `Harga ${shortDateLabel(heldOn)} ditahan karena berubah lebih dari 35%.`
      : `Harga ${shortDateLabel(heldOn)} ditahan karena berubah lebih dari 35%. Yang dipakai masih harga ${shortDateLabel(usedOn)}.`,
  dlCost: 'Biaya beli',
  dlAvg: 'Harga rata-rata',
  dlLast: 'Harga terakhir',
  dlMarket: 'Nilai pasar',
  dlUnrealized: 'Belum terealisasi',
  dlRealized: 'Sudah terealisasi',
  buyMore: 'Beli lagi',
  sellOne: 'Jual',
  tradesOf: (ticker: string) => `Transaksi ${ticker}`,
  cancel: 'Batalkan',
  cancelNote: 'Hanya transaksi terakhir yang bisa dibatalkan.',
  tradeLine: (side: 'buy' | 'sell' | 'opening', shares: number, price: Rupiah) =>
    `${side === 'buy' ? 'Beli' : side === 'sell' ? 'Jual' : 'Saham berjalan'} ${sharesShort(shares)} @ ${formatRupiah(price)}`,

  // Sheet (SH3 sampai SH6)
  buyTitle: 'Beli saham · Pribadi',
  sellTitle: 'Jual saham · Pribadi',
  priceTitle: 'Isi harga · Pribadi',
  openTitle: 'Saham yang sudah dimiliki · Pribadi',
  tickerField: 'Kode saham',
  tickerHint: '4 huruf, misalnya BBCA.',
  amountField: 'Jumlah',
  unitLot: 'Lot',
  unitShare: 'Lembar',
  equalsShares: (n: number) => `= ${groupLot(n)} lembar`,
  equalsLots: (n: number) => `= ${groupLot(n)} lot`,
  priceField: 'Harga per lembar',
  feeField: 'Biaya broker',
  feeHint: 'Dari konfirmasi broker. Masuk ke biaya beli.',
  taxField: 'Pajak jual',
  taxHint: 'PPh final dari konfirmasi broker.',
  fromField: 'Dari dompet',
  toField: 'Ke dompet',
  dateField: 'Tanggal',
  total: (value: Rupiah) => `Total keluar ${formatRupiah(value)}`,
  totalNote: 'Perkiraan. Angka pasti muncul sesudah disimpan.',
  tradingNote: (name: string) => `Pindah dari ${name} ke saham tidak mengubah modal trading.`,
  saveBuy: 'Simpan pembelian',
  saveBuyAnyway: 'Tetap simpan pembelian',
  saveSell: 'Simpan penjualan',
  owned: (shares: number) => `Dimiliki ${sharesLabel(shares)}`,
  sellAll: 'Jual semua',
  netLabel: 'Hasil bersih',
  costOutLabel: 'Biaya beli yang keluar',
  previewLoading: 'Menghitung…',
  netNonPositive: 'Biaya dan pajak lebih besar dari hasil jual.',
  gainLabel: 'Untung atau rugi',
  previewFailed: 'Pratinjau belum bisa dihitung. Angka pasti muncul sesudah disimpan.',
  priceClose: 'Harga penutupan per lembar',
  priceDateField: 'Tanggal harga',
  lastPrice: (value: Rupiah, on: IsoDate) =>
    `Harga terakhir ${formatRupiah(value)} · ${shortDateLabel(on)}`,
  noPriceYet: 'Belum ada harga.',
  priceScope: (ticker: string) => `Harga berlaku untuk ${ticker} di semua dompet saham Pribadi.`,
  spike: (on: IsoDate | null) =>
    on === null
      ? 'Harga ini berubah lebih dari 35% dari harga sebelumnya. Periksa lagi angkanya, misalnya bila ada pemecahan saham.'
      : `Harga ini berubah lebih dari 35% dari harga ${shortDateLabel(on)}. Periksa lagi angkanya, misalnya bila ada pemecahan saham.`,
  spikeConfirm: 'Ya, harga ini benar',
  savePrice: 'Simpan harga',
  avgField: 'Harga rata-rata per lembar',
  avgHint: 'Lihat di aplikasi broker, biasanya tertulis harga rata-rata atau avg price.',
  sinceField: 'Sejak',
  openNote: 'Tidak mengurangi dompet mana pun. Saham ini langsung masuk kekayaan bersih.',
  openAdds: (ticker: string) => `Menambah ke ${ticker} yang sudah ada.`,
  saveOpen: 'Simpan saham',
  noCash: 'Belum ada dompet untuk pembelian. Tambah dompet dulu di tab Dompet.',

  // Toast
  bought: (ticker: string, shares: number, amount: Rupiah, from: string) =>
    `Beli ${ticker} ${sharesShort(shares)} dicatat · ${formatRupiah(amount)} dari ${from}`,
  sold: (ticker: string, shares: number, proceeds: Rupiah, to: string) =>
    `Jual ${ticker} ${sharesShort(shares)} dicatat · ${formatRupiah(proceeds)} ke ${to}`,
  opened: (ticker: string, shares: number, account: string) =>
    `${ticker} ${groupLot(shares)} lembar ditambahkan ke ${account}`,
  priceSaved: (ticker: string, on: IsoDate) => `Harga ${ticker} ${shortDateLabel(on)} disimpan`,

  // Dialog batal (SH7)
  voidTitle: 'Batalkan transaksi saham terakhir?',
  voidBuy: (ticker: string, shares: number, on: IsoDate, from: string) =>
    `Beli ${ticker} ${sharesShort(shares)} pada ${shortDateLabel(on)} dibatalkan. ${from} bertambah lagi, lembar dan harga rata-rata kembali seperti sebelumnya.`,
  voidSell: (ticker: string, shares: number, on: IsoDate, to: string) =>
    `Jual ${ticker} ${sharesShort(shares)} pada ${shortDateLabel(on)} dibatalkan. ${to} berkurang lagi, dan untung atau rugi penjualan itu ikut batal.`,
  voidOpen: (ticker: string, shares: number, on: IsoDate, account: string) =>
    `${ticker} ${groupLot(shares)} lembar yang dimasukkan pada ${shortDateLabel(on)} dihapus dari ${account}.`,
  voidRestorable: 'Bisa dipulihkan dari Sampah.',
  voidNotLatest: (ticker: string) =>
    `Sudah ada transaksi ${ticker} yang lebih baru. Muat ulang halaman.`,
  voidNotFound: 'Transaksi ini tidak ditemukan. Muat ulang halaman.',
  voidConfirm: 'Batalkan transaksi',
  voidAnyway: 'Tetap batalkan',
  back: 'Kembali',
  voided: (ticker: string) => `Transaksi ${ticker} dibatalkan`,
  undo: 'Urungkan',
  undoFailed: 'Belum bisa diurungkan. Buka Sampah untuk memulihkannya.',

  // Arsip
  viewStock: 'Lihat saham',
} as const;

/** Ringkasan satu holding yang bisa ditampilkan sebagai kata keadaan harga (SH2). */
export type PriceState = 'fresh' | 'stale' | 'none' | 'held';

export function priceStateOf(h: StockHoldingVM): PriceState {
  if (h.heldPending) return 'held';
  if (h.close === null) return 'none';
  return h.stale ? 'stale' : 'fresh';
}
