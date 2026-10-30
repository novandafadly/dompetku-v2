/** Bilangan bulat rupiah (Number.isSafeInteger). */
export type Rupiah = number;

const NBSP = ' ';
const MINUS = '−';

// Pengelompokan ribuan manual: Intl berbeda antara server dan klien.
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+$)/g, '.');
}

export function formatRupiah(n: Rupiah, opts: { sign?: 'auto' | 'always' } = {}): string {
  const body = `Rp${NBSP}${groupThousands(String(Math.abs(n)))}`;
  if (n < 0) return `${MINUS}${body}`;
  if (n > 0 && opts.sign === 'always') return `+${body}`;
  return body;
}

const COMPACT_UNITS = [
  { size: 1e9, label: 'M' },
  { size: 1e6, label: 'jt' },
  { size: 1e3, label: 'rb' },
] as const;

export function formatRupiahCompact(n: Rupiah): string {
  const abs = Math.abs(n);
  const unit = COMPACT_UNITS.find((u) => abs >= u.size);
  if (!unit) return formatRupiah(n);
  // Hitung dalam ratusan unit (bilangan bulat) lalu potong, tanpa pembulatan.
  const hundredths = Math.floor(abs / (unit.size / 100));
  const whole = groupThousands(String(Math.floor(hundredths / 100)));
  const frac = String(hundredths % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  const num = frac ? `${whole},${frac}` : whole;
  return `${n < 0 ? MINUS : ''}Rp${NBSP}${num} ${unit.label}`;
}

const PLAIN_DIGITS = /^\d+$/;
const DOTTED_DIGITS = /^\d{1,3}(\.\d{3})+$/;

export function parseRupiah(input: string): Rupiah | null {
  const s = input
    .trim()
    .replace(/^Rp\s*/, '')
    .trim();
  if (!PLAIN_DIGITS.test(s) && !DOTTED_DIGITS.test(s)) return null;
  const n = Number(s.replaceAll('.', ''));
  return Number.isSafeInteger(n) ? n : null;
}

const SPOKEN_PREFIX = {
  income: 'pemasukan ',
  expense: 'pengeluaran ',
  neutral: '',
} as const;

export function spokenRupiah(n: Rupiah, kind: 'income' | 'expense' | 'neutral'): string {
  const amount = `Rp ${groupThousands(String(Math.abs(n)))}`;
  return `${SPOKEN_PREFIX[kind]}${n < 0 ? 'minus ' : ''}${amount}`;
}
