import { createHash } from 'node:crypto';
import type pg from 'pg';

/**
 * Jeda bertahap gagal login tanpa kunci permanen (keputusan pemilik #4, TRD §3.4):
 * 5 gagal = jeda 1 menit, 10 = 15 menit, 20 = 1 jam (berulang tiap gagal berikutnya).
 * Penghitung per IP dan per akun, disimpan di auth.login_throttle sebagai hash; hitungan
 * kembali ke 0 setelah berhasil atau 24 jam tanpa gagal.
 */

export type ThrottleKind =
  | 'password'
  | 'totp'
  | 'recovery'
  | 'reset'
  | 'signup'
  | 'rl-undangan'
  | 'rl-passkey'
  | 'rl-verifikasi';

export function delaySeconds(failures: number): number {
  if (failures >= 20) return 60 * 60;
  if (failures >= 10) return 15 * 60;
  if (failures >= 5) return 60;
  return 0;
}

export function throttleKey(kind: ThrottleKind, scope: 'ip' | 'akun', value: string): Buffer {
  return createHash('sha256').update(`${kind}:${scope}:${value.trim().toLowerCase()}`).digest();
}

export type Attempt = { kind: 'allowed'; failures: number } | { kind: 'blocked'; seconds: number };

/**
 * Catat satu percobaan SEBELUM kredensial diperiksa (atomik per kunci, tanpa celah
 * periksa-lalu-catat untuk request paralel). Selama jeda aktif percobaan ditolak dan tidak
 * dihitung. Pemanggil menghapus hitungan saat berhasil (`clearFailures`).
 */
export async function beginAttempt(pool: pg.Pool, keys: Buffer[]): Promise<Attempt> {
  let failures = 0;
  let blocked = 0;
  for (const key of keys) {
    // Baris dikunci (FOR UPDATE): percobaan paralel untuk kunci yang sama diproses berurutan,
    // jadi ledakan request tidak bisa melewati ambang sebelum jeda terpasang.
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        'insert into auth.login_throttle (key, failures, updated_at) values ($1, 0, now()) on conflict (key) do nothing',
        [key],
      );
      const { rows } = await client.query<{
        failures: number;
        blocked: number | null;
        stale: boolean;
      }>(
        `select failures,
                case when blocked_until > now()
                     then ceil(extract(epoch from blocked_until - now()))::int end as blocked,
                updated_at < now() - interval '24 hours' as stale
           from auth.login_throttle where key = $1 for update`,
        [key],
      );
      const row = rows[0];
      if (row?.blocked) {
        blocked = Math.max(blocked, row.blocked);
      } else {
        const n = row?.stale ? 1 : (row?.failures ?? 0) + 1;
        failures = Math.max(failures, n);
        await client.query(
          `update auth.login_throttle
              set failures = $2, updated_at = now(),
                  blocked_until = case when $3::int > 0 then now() + make_interval(secs => $3::int) end
            where key = $1`,
          [key, n, delaySeconds(n)],
        );
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
  return blocked > 0 ? { kind: 'blocked', seconds: blocked } : { kind: 'allowed', failures };
}

/**
 * Batas laju sederhana (jendela tetap) untuk aksi tanpa kredensial: intip/tolak undangan, opsi
 * passkey, kirim ulang email. true = boleh.
 */
export async function rateHit(
  pool: pg.Pool,
  key: Buffer,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const { rows } = await pool.query<{ failures: number }>(
    `insert into auth.login_throttle as t (key, failures, updated_at) values ($1, 1, now())
     on conflict (key) do update
       set failures = case when t.updated_at < now() - make_interval(secs => $2) then 1
                           else t.failures + 1 end,
           updated_at = case when t.updated_at < now() - make_interval(secs => $2) then now()
                             else t.updated_at end
     returning failures`,
    [key, windowSeconds],
  );
  return (rows[0]?.failures ?? 1) <= limit;
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
