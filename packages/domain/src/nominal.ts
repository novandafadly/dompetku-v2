import { parseRupiah, type Rupiah } from './money';

const MULTIPLIER: Record<string, bigint> = {
  rb: 1_000n,
  ribu: 1_000n,
  k: 1_000n,
  jt: 1_000_000n,
  juta: 1_000_000n,
};

// "Rp" opsional, angka (desimal `,` atau `.`, maksimal 2 digit: 3 digit mirip pemisah ribuan
// sehingga ambigu, mis. "1,555rb" -> null), spasi opsional, satuan.
const WITH_UNIT = /^(?:rp\s*)?(\d+)(?:[.,](\d{1,2}))?\s*(rb|ribu|k|jt|juta)$/i;

/**
 * Nominal ketikan bebas -> rupiah bulat, atau null bila tidak sah.
 * Dengan satuan (`35rb`, `35k`, `1,5jt`) angka dikalikan dan desimal boleh `,`/`.`
 * asal hasilnya bulat. Tanpa satuan berlaku `parseRupiah` ("35" = Rp 35, tidak dikalikan).
 */
export function parseNominal(input: string): Rupiah | null {
  const m = WITH_UNIT.exec(input.trim());
  if (!m) return parseRupiah(input);
  const [, whole = '', frac = '', unit = ''] = m;
  const multiplier = MULTIPLIER[unit.toLowerCase()];
  if (multiplier === undefined) return null;
  const scaled = BigInt(whole + frac) * multiplier;
  const divisor = 10n ** BigInt(frac.length);
  if (scaled % divisor !== 0n) return null;
  const n = scaled / divisor;
  return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : null;
}
