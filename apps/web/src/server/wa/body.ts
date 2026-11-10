/**
 * Baca body request sebagai byte mentah dengan batas keras. Berhenti membaca dan membatalkan
 * stream begitu jumlah byte melewati `maxBytes`, sehingga body chunked tanpa Content-Length
 * tidak pernah ditampung utuh di memori. Body kosong/tidak ada = array kosong.
 */
export async function readBodyCapped(
  req: Request,
  maxBytes: number,
): Promise<Uint8Array | 'too_large'> {
  if (req.body === null) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return 'too_large';
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Pembatas log per proses: `allow()` true paling banyak sekali per `intervalMs`. Jam bisa
 * disuntik untuk tes.
 */
export function createLogThrottle(
  intervalMs: number,
  now: () => number = () => Date.now(),
): { allow(): boolean } {
  let last = Number.NEGATIVE_INFINITY;
  return {
    allow() {
      const t = now();
      if (t - last < intervalMs) return false;
      last = t;
      return true;
    },
  };
}
