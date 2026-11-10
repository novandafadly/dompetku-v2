/**
 * Nomor bot untuk tampilan dan tautan wa.me (spec 5.6). Murni (dipakai server dan klien).
 * Hanya angka yang dipakai di tautan; nomor yang tidak masuk akal dianggap belum diatur.
 */

/** Angka E.164 tanpa `+` (mis. `628110000111`), atau null bila bukan nomor yang masuk akal. */
export function normalizeBotNumber(raw: string | null): string | null {
  if (raw === null) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  return /^[1-9][0-9]{7,14}$/.test(digits) ? digits : null;
}

/** `628123456789` -> `+62 812-3456-789`; kode negara lain -> `+` lalu angka apa adanya. */
export function formatBotNumber(digits: string): string {
  if (!digits.startsWith('62')) return `+${digits}`;
  const rest = digits.slice(2);
  const groups = [rest.slice(0, 3)];
  for (let i = 3; i < rest.length; i += 4) groups.push(rest.slice(i, i + 4));
  return `+62 ${groups.join('-')}`;
}

/** Tautan wa.me ke bot dengan pesan terisi (`hubung KODE`, atau `hubung` saja tanpa kode). */
export function botChatHref(digits: string, code?: string): string {
  const text = code === undefined ? 'hubung' : `hubung ${code}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
