// Batas laju dalam memori (satu proses web) dengan jendela bergeser. Murni selain jam.

export interface RateLimiter {
  /** true = diizinkan dan dihitung; false = ditolak (penolakan tidak dihitung). */
  allow(key: string): boolean;
  /** Jumlah kunci yang sedang dilacak (pemantauan dan tes). */
  size(): number;
}

/**
 * Maksimum `max` hit per `windowMs` per kunci; hit tertua keluar jendela tepat `windowMs` sesudahnya.
 * Kunci yang semua hit-nya sudah lewat dibuang paling lambat sekali per jendela, sehingga nomor
 * asing yang mengirim sekali tidak menumpuk di memori.
 */
export function createRateLimiter(
  max: number,
  windowMs: number,
  now: () => number = Date.now,
): RateLimiter {
  if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('max harus bilangan bulat ≥ 1');
  if (!Number.isSafeInteger(windowMs) || windowMs < 1)
    throw new RangeError('windowMs harus bilangan bulat ≥ 1');
  const hits = new Map<string, number[]>();
  let lastSweep = now();

  return {
    allow(key) {
      const t = now();
      const floor = t - windowMs;
      if (t - lastSweep >= windowMs) {
        for (const [k, ts] of hits) if ((ts[ts.length - 1] ?? -Infinity) <= floor) hits.delete(k);
        lastSweep = t;
      }
      const ts = (hits.get(key) ?? []).filter((x) => x > floor);
      const ok = ts.length < max;
      if (ok) ts.push(t);
      if (ts.length > 0) hits.set(key, ts);
      else hits.delete(key);
      return ok;
    },
    size: () => hits.size,
  };
}

const HOUR = 3_600_000;
export const LINK_PER_PHONE_PER_HOUR = 5;
export const LINK_GLOBAL_PER_HOUR = 30;

/**
 * Percobaan `hubung KODE`: 5 per jam per nomor dan 30 per jam untuk semua nomor (kunci '*'),
 * pengaman tebak kode (kode 6 karakter, DB tidak membatasi). Nomor yang sudah habis jatahnya
 * tidak memakan jatah global.
 */
export function createLinkLimiter(now: () => number = Date.now): RateLimiter {
  const perPhone = createRateLimiter(LINK_PER_PHONE_PER_HOUR, HOUR, now);
  const global = createRateLimiter(LINK_GLOBAL_PER_HOUR, HOUR, now);
  return {
    allow: (key) => perPhone.allow(key) && global.allow('*'),
    size: () => perPhone.size(),
  };
}
