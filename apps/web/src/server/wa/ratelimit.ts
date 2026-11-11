// Batas laju dalam memori (satu proses web) dengan jendela bergeser. Murni selain jam.

export interface RateLimiter {
  /** true = diizinkan dan dihitung; false = ditolak (penolakan tidak dihitung). */
  allow(key: string): boolean;
  /** Jumlah kunci yang sedang dilacak (pemantauan dan tes). */
  size(): number;
}

/** Pembatas yang bisa ditanya tanpa menghitung hit (untuk menggabung dua batas secara atomik). */
interface PeekableRateLimiter extends RateLimiter {
  /** true bila `allow(key)` akan diizinkan sekarang; tidak menghitung dan tidak mengubah state. */
  peek(key: string): boolean;
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
  return createPeekableRateLimiter(max, windowMs, now);
}

function createPeekableRateLimiter(
  max: number,
  windowMs: number,
  now: () => number,
): PeekableRateLimiter {
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
    peek(key) {
      const floor = now() - windowMs;
      return (hits.get(key) ?? []).filter((x) => x > floor).length < max;
    },
    size: () => hits.size,
  };
}

const HOUR = 3_600_000;
export const LINK_PER_PHONE_PER_HOUR = 5;
export const LINK_GLOBAL_PER_HOUR = 30;

/**
 * Percobaan `hubung KODE`: 5 per jam per nomor dan 30 per jam untuk semua nomor (kunci '*'),
 * pengaman tebak kode (kode 6 karakter, DB tidak membatasi). Penolakan tidak memakan jatah mana
 * pun: nomor yang sudah habis jatahnya tidak memakan jatah global, dan percobaan yang ditolak
 * karena global penuh tidak memakan jatah nomor itu. Batas global sengaja menghitung semua
 * percobaan (termasuk percobaan pertama tiap nomor): melonggarkannya membuka tebak kode dengan
 * banyak nomor; akibatnya kunci global bisa menahan penautan nomor baru selama maksimum satu jam.
 */
export function createLinkLimiter(now: () => number = Date.now): RateLimiter {
  const perPhone = createPeekableRateLimiter(LINK_PER_PHONE_PER_HOUR, HOUR, now);
  const global = createRateLimiter(LINK_GLOBAL_PER_HOUR, HOUR, now);
  return {
    allow(key) {
      if (!perPhone.peek(key)) return false;
      if (!global.allow('*')) return false;
      return perPhone.allow(key);
    },
    size: () => perPhone.size(),
  };
}
