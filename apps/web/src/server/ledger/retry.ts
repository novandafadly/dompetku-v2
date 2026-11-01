import type pg from 'pg';
import { withUser, type Pools } from '../db';

/**
 * Pengulangan transaksi ledger (BSD §9.2): `40001` (serialization_failure) dan `40P01`
 * (deadlock_detected) diulang maksimal 3 kali (4 percobaan). Yang diulang adalah SELURUH
 * transaksi `withUser` (koneksi + `begin` baru), bukan pernyataan terakhir: transaksi yang gagal
 * sudah di-rollback, dan fungsi tulis `api.*` idempoten lewat `p_client_id`.
 * Isolasi tetap bawaan role (READ COMMITTED); tidak ada `SET TRANSACTION ISOLATION`.
 * Tidak ada log di sini (argumen SQL tidak pernah dilog).
 */
export const MAX_RETRIES = 3;

const RETRYABLE = new Set(['40001', '40P01']);

function isRetryable(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const code = (e as { code?: unknown }).code;
  return typeof code === 'string' && RETRYABLE.has(code);
}

/** Jeda pendek berjitter (± 5–40 ms) agar dua transaksi yang bertabrakan tidak bertemu lagi. */
function backoff(attempt: number): Promise<void> {
  const ms = 5 * 2 ** attempt + Math.random() * 5 * 2 ** attempt;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Satu operasi ledger di satu ruang: `withUser(pools.app, userId, fn, spaceId)` (konteks
 * `app.user_id` + `app.assert_member`) dengan pengulangan 40001/40P01.
 * `fn` bisa dipanggil lebih dari sekali: jangan menaruh efek samping di luar transaksi di dalamnya.
 */
export async function withLedger<T>(
  pools: Pools,
  userId: string,
  spaceId: string,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withUser(pools.app, userId, fn, spaceId);
    } catch (e) {
      if (attempt >= MAX_RETRIES || !isRetryable(e)) throw e;
      await backoff(attempt);
    }
  }
}
