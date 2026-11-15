import { formatRupiah, shortDateLabel, type IsoDate, type Rupiah } from '@dompetku/domain';

/**
 * Salinan final S12 (`docs/design/s12-bingkai.md`, bagian PT1 sampai PT4, CT1, CT2, AK1, AK2).
 * Satu sumber untuk Server Component dan pulau klien; tanpa nominal di salinan galat.
 */
export const PATUNGAN_COPY = {
  title: 'Saldo patungan',
  pageTitle: 'Patungan · Bersama',
  menu: 'Patungan',
  impas: 'Patungan impas',
  settle: 'Lunasi',
  receive: 'Terima',
  see: 'Lihat patungan',
  history: 'Riwayat',
  waiting: 'Menunggu diterima',
  received: 'Diterima',
  delete: 'Hapus',
  cancel: 'Batalkan',
  restore: 'Pulihkan',
  more: 'Muat lagi',
  back: 'Kembali',
  loading: 'Memuat patungan…',
  empty: 'Belum ada tagihan patungan.',
  emptyHint:
    'Saat kamu membayar tagihan Bersama dari dompet pribadi, catat di sini supaya pembagiannya jelas.',
  emptyAction: 'Catat pengeluaran Bersama',
  soloTitle: 'Patungan butuh dua anggota.',
  soloHint: (partner: string | null) =>
    partner === null ? 'Ajak Farida ke Bersama dulu.' : `Ajak ${partner} ke Bersama dulu.`,
  inviteAction: 'Undang Farida',
  loadFailed: 'Patungan belum bisa dimuat.',
  loadFailedHint: 'Sambungan ke server terputus. Catatan yang sudah tersimpan tidak hilang.',
  cardFailed: 'Saldo patungan belum bisa dimuat.',
  retry: 'Coba lagi',
  // Catat (CT1, CT2)
  toggle: 'Dibayar dari dompet pribadi',
  fromPersonal: 'Dari dompet pribadi',
  noPersonalWallet: 'Belum ada dompet di Pribadi. Tambah dompet di Pribadi dulu.',
  editShares: 'Ubah pembagian',
  sharesTitle: 'Pembagian · Bersama',
  howToSplit: 'Cara bagi',
  equal: 'Sama rata',
  custom: 'Atur nominal',
  useShares: 'Pakai pembagian ini',
  myShare: (amount: Rupiah) => `Bagian kamu ${formatRupiah(amount)}`,
  // Lunasi (PT3)
  settleTitle: 'Lunasi patungan · Bersama',
  settleAmount: 'Jumlah dilunasi',
  all: 'Semua',
  fromWallet: 'Dari dompet pribadi',
  date: 'Tanggal',
  afterThis: 'Setelah ini',
  paidOff: 'Dilunasi',
  afterwards: 'Sesudahnya',
  now: 'Sekarang',
  anyway: 'Tetap lunasi',
  paidLabel: 'Dilunasi',
  // Terima (PT4)
  receiveTitle: 'Terima pelunasan · Bersama',
  receiveTo: 'Terima ke dompet',
  // Dialog akibat
  deleteTitle: 'Hapus tagihan patungan ini?',
  deleteConfirm: 'Hapus tagihan',
  cancelSettleTitle: 'Batalkan pelunasan ini?',
  cancelSettleConfirm: 'Batalkan pelunasan',
  cancelReceiptTitle: 'Batalkan penerimaan?',
  cancelReceiptConfirm: 'Batalkan penerimaan',
  deletedGroup: (n: number) => `Patungan dihapus (${String(n)})`,
  undo: 'Urungkan',
  loadingWallet: 'Memuat dompet…',
} as const;

export const nameOrYou = (id: string, meId: string, name: string): string =>
  id === meId ? 'kamu' : name;

/** `Kamu berutang Rp … ke {nama}` / `{nama} berutang Rp … ke kamu`: potongan sebelum/sesudah nominal. */
export function debtSentence(
  vm: {
    me: { id: string; name: string };
    partner: { name: string };
    debtorId: string | null;
  },
  amount: Rupiah,
): { before: string; amount: string; after: string; text: string } {
  const meDebtor = vm.debtorId === vm.me.id;
  const before = meDebtor ? 'Kamu berutang ' : `${vm.partner.name} berutang `;
  const after = meDebtor ? ` ke ${vm.partner.name}` : ' ke kamu';
  const amt = formatRupiah(amount);
  return { before, amount: amt, after, text: `${before}${amt}${after}` };
}

export const settledCounts = (splits: number, settlements: number): string =>
  `Dari ${String(splits)} tagihan patungan dan ${String(settlements)} pelunasan.`;

export const pendingLine = (name: string, amount: Rupiah): string =>
  `${name} sudah melunasi ${formatRupiah(amount)}. Terima ke dompet?`;

export const shareNote = (partner: string, amount: Rupiah): string =>
  `${partner} menanggung ${formatRupiah(amount)}`;

export const sharesRemark = (amount: Rupiah, odd: boolean): string =>
  odd
    ? `Masing-masing ${formatRupiah(amount)}. Sisa Rp1 ditanggung kamu.`
    : `Masing-masing ${formatRupiah(amount)}.`;

export const savedToast = (amount: Rupiah, wallet: string, partner: string, share: Rupiah) =>
  `Patungan dicatat di Bersama · ${formatRupiah(amount)} dari ${wallet} · ${shareNote(partner, share)}`;

export const settledToast = (amount: Rupiah, wallet: string, partner: string) =>
  `Pelunasan dicatat di Bersama · ${formatRupiah(amount)} dari ${wallet} · menunggu ${partner} menerima`;

export const receivedToast = (from: string, amount: Rupiah, wallet: string) =>
  `Diterima dari ${from} · ${formatRupiah(amount)} ke ${wallet}`;

export const dateLabel = (d: IsoDate): string => shortDateLabel(d);
