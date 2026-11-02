import { formatRupiah, formatRupiahCompact, spokenRupiah, type Rupiah } from '@dompetku/domain';

export type MoneyKind = 'income' | 'expense' | 'neutral';

/** Ukuran nominal Panel Malam: baris 15/700, rincian 14/500, kartu utama 44 (laptop 56), detail 40. */
const sizes = {
  list: 'text-body font-bold',
  row: 'text-label font-medium',
  hero: 'text-display font-extrabold laptop:text-display-xl',
  amount: 'text-amount font-extrabold',
  'amount-sm': 'text-amount-sm font-extrabold',
  inherit: '',
} as const;

/** Skala nominal sangat panjang (> 13 karakter) di HP; satu aturan untuk semua ukuran besar. */
const longSizes: Partial<Record<keyof typeof sizes, string>> = {
  hero: 'text-display-long font-extrabold laptop:text-display-xl',
  amount: 'text-display-long font-extrabold',
  'amount-sm': 'text-display-long font-extrabold',
};

const tones: Record<MoneyKind, string> = {
  income: 'text-income',
  expense: '',
  neutral: '',
};

export function MoneyText({
  value,
  kind = 'neutral',
  size = 'list',
  compact = false,
  className = '',
}: {
  value: Rupiah;
  kind?: MoneyKind;
  size?: keyof typeof sizes;
  compact?: boolean;
  className?: string;
}) {
  // Pemasukan selalu bertanda "+" (handoff: aturan global format uang).
  const text = compact
    ? formatRupiahCompact(value)
    : formatRupiah(value, kind === 'income' ? { sign: 'always' } : {});
  // Jenis (pemasukan/pengeluaran) sudah membawa arah; tanda minus hanya diucapkan untuk netral.
  const spoken = spokenRupiah(kind === 'neutral' ? value : Math.abs(value), kind);

  // Angka sangat panjang memakai skala yang lebih kecil di HP agar tidak keluar dari kartu.
  const sizeClass = (text.length > 13 ? longSizes[size] : undefined) ?? sizes[size];
  return (
    <span className={`num inline-block max-w-full ${sizeClass} ${tones[kind]} ${className}`}>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
