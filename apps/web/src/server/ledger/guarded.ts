import 'server-only';
import type pg from 'pg';
import { isSpaceNotFoundError } from './errors';

/**
 * Dilempar ulang dari savepoint: 40001/40P01 (ulang seluruh transaksi) dan galat otorisasi ruang
 * (`DK401` / `DK404 space_not_found`, keanggotaan dicabut di tengah muat: tetap `not_found`, bukan
 * kartu galat). `DK404` level item tetap ditangkap savepoint kartu.
 */
function shouldRethrow(e: unknown): boolean {
  if (isSpaceNotFoundError(e)) return true;
  const code = (e as { code?: unknown } | null)?.code;
  return code === '40001' || code === '40P01';
}

/** Kartu Beranda yang dibaca di savepoint sendiri; nama = bagian nama savepoint dan log. */
export type GuardedCard = 'activity' | 'contributions' | 'bills' | 'budgets' | 'debts';

const PREFIX: Record<GuardedCard, string> = {
  activity: 'bersama',
  contributions: 'bersama',
  bills: 'beranda',
  budgets: 'beranda',
  debts: 'beranda',
};

/**
 * Bacaan kartu Beranda di savepoint (pola S8 Task 4): galat (SQL atau validasi) hanya mematikan
 * kartu itu (`'error'`), Beranda tetap tampil. 40001/40P01 dilempar ulang agar `withLedger`
 * mengulang seluruh transaksi, DK401/DK404 agar tetap `not_found`; koneksi putus membuat
 * `rollback to savepoint` gagal dan galatnya ikut dilempar. Log hanya SQLSTATE (tanpa pesan,
 * argumen, atau nominal). Nama savepoint dari union tetap (tanpa input).
 */
export async function guarded<T>(
  c: pg.PoolClient,
  what: GuardedCard,
  fn: () => Promise<T>,
): Promise<T | 'error'> {
  const sp = `${PREFIX[what]}_${what}`;
  await c.query(`savepoint ${sp}`);
  try {
    const value = await fn();
    await c.query(`release savepoint ${sp}`);
    return value;
  } catch (e) {
    if (shouldRethrow(e)) throw e;
    const code = (e as { code?: unknown } | null)?.code;
    await c.query(`rollback to savepoint ${sp}`);
    const safe = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'non-sql';
    console.error(`[${PREFIX[what]}] ${what} gagal dimuat: ${safe}`);
    return 'error';
  }
}
