import { createHash } from 'node:crypto';
import type pg from 'pg';

/**
 * Jeda bertahap gagal login tanpa kunci permanen (keputusan pemilik #4, TRD §3.4):
 * 5 gagal = jeda 1 menit, 10 = 15 menit, 20 = 1 jam (berulang tiap gagal berikutnya).
 * Penghitung per IP dan per akun, disimpan di auth.login_throttle sebagai hash; hitungan
 * kembali ke 0 setelah berhasil atau 24 jam tanpa gagal.
 */

export type ThrottleKind = 'password' | 'totp' | 'recovery' | 'reset' | 'signup';

export function delaySeconds(failures: number): number {
  if (failures >= 20) return 60 * 60;
  if (failures >= 10) return 15 * 60;
  if (failures >= 5) return 60;
  return 0;
}

export function throttleKey(kind: ThrottleKind, scope: 'ip' | 'akun', value: string): Buffer {
  return createHash('sha256').update(`${kind}:${scope}:${value.trim().toLowerCase()}`).digest();
}

/** Sisa jeda terlama (detik) di antara kunci; 0 = boleh mencoba. */
export async function remainingDelay(pool: pg.Pool, keys: Buffer[]): Promise<number> {
  const { rows } = await pool.query<{ s: number | null }>(
    `select ceil(extract(epoch from max(blocked_until) - now()))::int as s
       from auth.login_throttle where key = any($1) and blocked_until > now()`,
    [keys],
  );
  return Math.max(0, rows[0]?.s ?? 0);
}

/** Catat satu kegagalan per kunci; kembalikan jumlah gagal terbesar dan jeda yang berlaku. */
export async function recordFailure(
  pool: pg.Pool,
  keys: Buffer[],
): Promise<{ failures: number[]; delay: number }> {
  const failures: number[] = [];
  for (const key of keys) {
    const { rows } = await pool.query<{ failures: number }>(
      `insert into auth.login_throttle as t (key, failures, updated_at) values ($1, 1, now())
       on conflict (key) do update
         set failures = case when t.updated_at < now() - interval '24 hours' then 1
                             else t.failures + 1 end,
             updated_at = now()
       returning failures`,
      [key],
    );
    const n = rows[0]?.failures ?? 1;
    failures.push(n);
    const delay = delaySeconds(n);
    if (delay > 0)
      await pool.query(
        `update auth.login_throttle set blocked_until = now() + make_interval(secs => $2)
          where key = $1`,
        [key, delay],
      );
  }
  return { failures, delay: delaySeconds(Math.max(0, ...failures)) };
}

export async function clearFailures(pool: pg.Pool, keys: Buffer[]): Promise<void> {
  await pool.query('delete from auth.login_throttle where key = any($1)', [keys]);
}

/** Bersihkan baris lama (dipanggil oportunistik; tabel kecil). */
export async function pruneThrottle(pool: pg.Pool): Promise<void> {
  await pool.query(
    "delete from auth.login_throttle where updated_at < now() - interval '2 days' and (blocked_until is null or blocked_until < now())",
  );
}
