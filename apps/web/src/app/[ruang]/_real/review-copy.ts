import type { Ruang } from '@/features/ledger/types';
import { RUANG_NAME } from '@/features/rencana/copy';

/** Salinan Review bulanan (bingkai `docs/design/s10-bingkai.md`, "Salinan final S10"). Tanpa nominal di galat. */
export const REVIEW_COPY = {
  link: 'Review bulanan',
  title: (bulan: string) => `Review ${bulan}`,
  summary: 'Ringkasan',
  versus: 'Rencana vs kenyataan',
  unbudgeted: 'Tanpa anggaran',
  setInRencana: 'Atur di Rencana',
  toRencana: 'Ke Rencana',
  noBudgetTitle: 'Belum ada anggaran di periode ini.',
  emptyTitle: 'Belum ada data di periode ini.',
  failedTitle: 'Review belum bisa dimuat.',
  failedDescription: 'Sambungan ke server terputus. Catatan yang sudah tersimpan tidak hilang.',
  loading: 'Memuat review…',
  prepare: (bulan: string) => `Siapkan ${bulan}`,
  prepareBody: (dari: string, ke: string) =>
    `Salin anggaran ${dari} ke ${ke}. Yang sudah ada di tujuan tidak ditimpa.`,
  adjust: 'Penyesuaian',
  same: 'Sama',
  other: 'Lain…',
  adjustField: 'Penyesuaian (%)',
  rounded: 'Dibulatkan ke Rp1.000.',
  copyN: (n: number) => `Salin ${String(n)} anggaran`,
  copying: 'Menyalin…',
  errPct: 'Isi bilangan bulat antara −90 dan 100.',
  allExist: (bulan: string) => `Semua anggaran sudah ada di ${bulan}.`,
  copied: (n: number, bulan: string, ruang: Ruang, skipped: number, pct: number) =>
    `${String(n)} anggaran disalin ke ${bulan} · ${RUANG_NAME[ruang]}${
      skipped > 0 ? ` · ${String(skipped)} dilewati` : ''
    }${pct !== 0 ? ` · disesuaikan ${pct > 0 ? '+' : '−'}${String(Math.abs(pct))}%` : ''}`,
} as const;

/** Pilihan cepat penyesuaian; `other` membuka kolom angka. */
export const ADJUST_ITEMS = [
  { value: '0', label: REVIEW_COPY.same },
  { value: '-10', label: '−10%' },
  { value: '-5', label: '−5%' },
  { value: '5', label: '+5%' },
  { value: '10', label: '+10%' },
  { value: 'other', label: REVIEW_COPY.other },
] as const;

/** Bilangan bulat −90..100 dari teks kolom `Lain…`; selain itu `null`. */
export function parseAdjust(text: string): number | null {
  const t = text.trim().replace('−', '-');
  if (!/^[+-]?\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= -90 && n <= 100 ? n : null;
}
