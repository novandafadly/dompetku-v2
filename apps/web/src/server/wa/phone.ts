// Normalisasi nomor pengirim WhatsApp ke E.164 (format kolom app.wa_links.phone_e164). Murni.

const E164_DIGITS = /^[1-9][0-9]{7,14}$/;
/** Sufiks JID yang membawa nomor telepon. `@lid` (ID tertaut) tidak membawa nomor. */
const PHONE_SUFFIXES = new Set(['c.us', 's.whatsapp.net']);

/**
 * '+62…', '62…', '08…' (nasional Indonesia → +62), '…@c.us', '…@s.whatsapp.net' (termasuk sufiks
 * perangkat '…:12@s.whatsapp.net') → '+62…'. `@lid`, sufiks lain, atau hasil di luar
 * `^\+[1-9][0-9]{7,14}$` → null (pemanggil memperlakukannya sebagai nomor tak dikenal).
 */
export function toE164(raw: string): string | null {
  let s = raw.trim();
  const at = s.indexOf('@');
  if (at >= 0) {
    if (!PHONE_SUFFIXES.has(s.slice(at + 1).toLowerCase())) return null;
    s = s.slice(0, at).replace(/:[0-9]+$/, '');
  }
  s = s.replace(/[\s-]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('08')) s = `62${s.slice(1)}`;
  return E164_DIGITS.test(s) ? `+${s}` : null;
}
