import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createPools, withUser } from '../../db';
import { toLedgerError } from '../errors';

/**
 * Pool habis atau DB tak terjangkau: `connect()` gagal sesudah `connectionTimeoutMillis`
 * (`timeout exceeded when trying to connect`) dan dipetakan ke `network`, bukan menggantung.
 */

function databaseUrl(): string {
  const v = process.env.TEST_DATABASE_URL;
  if (!v) throw new Error('TEST_DATABASE_URL wajib diisi untuk tes integrasi');
  return v;
}

async function failure(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error('seharusnya gagal');
    },
    (e: unknown) => e,
  );
}

describe('pool habis = network', () => {
  it('createPools memasang connectionTimeoutMillis 5000', async () => {
    const pools = createPools(databaseUrl());
    try {
      for (const pool of [pools.app, pools.auth]) {
        expect(
          (pool as unknown as { options: pg.PoolConfig }).options.connectionTimeoutMillis,
        ).toBe(5000);
      }
    } finally {
      await Promise.all([pools.app.end(), pools.auth.end()]);
    }
  });

  it('koneksi tidak didapat sebelum batas waktu = network', async () => {
    // Pool kecil sendiri agar pool bersama tidak terganggu.
    const pool = new pg.Pool({
      connectionString: databaseUrl(),
      max: 1,
      connectionTimeoutMillis: 200,
    });
    const held = await pool.connect();
    try {
      const err = await failure(
        withUser(pool, randomUUID(), () => Promise.resolve('tidak sampai')),
      );
      expect(toLedgerError(err)).toEqual({ code: 'network' });
    } finally {
      held.release();
      await pool.end();
    }
  });
});
