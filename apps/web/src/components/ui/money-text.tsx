import { formatRupiah, formatRupiahCompact, spokenRupiah, type Rupiah } from '@dompetku/domain';

export type MoneyKind = 'income' | 'expense' | 'neutral';

const sizes = {
  list: 'text-base font-medium',
  hero: 'font-hero text-3xl font-semibold',
} as const;

const tones: Record<MoneyKind, string> = {
  income: 'text-income',
  expense: 'text-text',
  neutral: 'text-text',
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
  const text = compact ? formatRupiahCompact(value) : formatRupiah(value);
  const match = /^([+−]?)Rp(.*)$/s.exec(text);
  const sign = match?.[1] ?? '';
  const rest = match?.[2] ?? text;
  // Jenis (pemasukan/pengeluaran) sudah membawa arah; tanda minus hanya diucapkan untuk netral.
  const spoken = spokenRupiah(kind === 'neutral' ? value : Math.abs(value), kind);

  return (
    <span
      className={`num inline-block max-w-full whitespace-nowrap ${sizes[size]} ${tones[kind]} ${className}`}
    >
      <span aria-hidden="true">
        {sign}
        <span className="text-text-muted">Rp</span>
        {rest}
      </span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
