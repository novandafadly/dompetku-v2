import type { KalenderDays } from './types';

/** Salinan final Kalender arus kas (bingkai `docs/design/s16-bingkai.md`, S16-KL*); tanpa `!` dan tanpa `Rp 0`. */
export const KALENDER_COPY = {
  link: 'Lihat kalender arus kas',
  title: 'Kalender arus kas',
  back: 'Kembali ke Tagihan',
  windowAria: 'Rentang kalender arus kas',
  windowLabel: (d: KalenderDays) => `${String(d)} hari`,
  startBalance: 'Saldo operasional hari ini',
  billsTotal: 'Tagihan dalam rentang',
  lowestBalance: 'Saldo terendah',
  shortBadge: 'Kurang',
  shortStarts: (dateText: string) => `Saldo diperkirakan kurang mulai ${dateText}.`,
  honestNote:
    'Hanya menghitung saldo operasional hari ini dikurangi tagihan terjadwal. Pemasukan belum diproyeksikan.',
  noBalance: 'Belum ada saldo',
  noBills: 'Belum ada tagihan',
  zeroBalance: 'Habis tanpa sisa',
  billsCount: (n: number) => `${String(n)} tagihan`,
  scheduleHeading: (daysCount: number) => `Jadwal tagihan (${String(daysCount)} hari)`,
  todayPrefix: 'Hari ini',
  overdueBadge: (dueText: string) => `Lewat jatuh tempo (${dueText})`,
  projectedBadge: 'Perkiraan',
  closingLabel: 'Saldo akhir',
  emptyTitle: 'Tidak ada tagihan terjadwal',
  emptyDescription: (days: KalenderDays) =>
    `Tidak ada tagihan terbuka dalam ${String(days)} hari ke depan. Saldo operasional diperkirakan tetap.`,
  emptyAction: 'Kelola tagihan',
  failedTitle: 'Kalender belum bisa dimuat',
  failedDescription: 'Sambungan ke server terputus. Coba muat ulang.',
  loadingLabel: 'Memuat kalender arus kas',
} as const;
