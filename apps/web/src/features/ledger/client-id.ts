/**
 * Kunci idempoten Catat: UUID v4 (`8-4-4-4-12`). `crypto.getRandomValues` dipakai, bukan
 * `randomUUID`, karena tersedia juga di konteks non-HTTPS (mis. HP di jaringan lokal).
 */
export function newClientId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40; // versi 4
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // varian RFC 4122 (8–b)
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
