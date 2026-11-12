import type { Ruang } from '@/features/ledger/types';
import { RUANG_NAME } from '@/features/rencana/copy';

/** Salinan ekspor CSV (bingkai `docs/design/s10-bingkai.md`, "Salinan final S10"); tanpa nominal. */
export const EKSPOR_COPY = {
  button: 'Ekspor CSV',
  busy: 'Menyiapkan…',
  hint: (title: string, ruang: Ruang) =>
    `Semua transaksi ${title} · ${RUANG_NAME[ruang]}. Dibuka di Excel atau Sheets.`,
  done: (title: string, ruang: Ruang) => `Ekspor ${title} · ${RUANG_NAME[ruang]} selesai`,
  errTooLarge: 'Terlalu banyak transaksi untuk satu ekspor. Pilih periode yang lebih pendek.',
  errRate: 'Terlalu sering mengunduh. Coba lagi nanti.',
  errSession: 'Sesi berakhir. Masuk lagi, lalu coba ekspor sekali lagi.',
  errGeneric: 'Belum berhasil. Sambungan ke server terputus. Coba lagi.',
} as const;
