import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { Pools } from '../db';
import { MAX_RETRIES, withLedger } from './retry';

const USER = '0b7a3c1e-5d2f-4a8b-9c6d-1e2f3a4b5c6d';
const SPACE = '7e8f9a0b-1c2d-4e3f-8a5b-6c7d8e9f0a1b';

/** Pool palsu: mencatat setiap koneksi dan perintah SQL (tanpa argumen) per transaksi. */
function fakePools() {
  const sessions: string[][] = [];
  const connect = vi.fn(() => {
    const log: string[] = [];
    sessions.push(log);
    const client = {
      query: vi.fn((sql: string) => {
        log.push(sql);
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    return Promise.resolve(client as unknown as pg.PoolClient);
  });
  const app = { connect } as unknown as pg.Pool;
  const pools: Pools = { app, auth: {} as pg.Pool };
  return { pools, sessions, connect };
}

function sqlState(code: string): Error {
  return Object.assign(new Error('serialisasi gagal'), { code });
}

describe('withLedger: withUser + ulang 40001/40P01 (BSD §9.2)', () => {
  it('MAX_RETRIES = 3', () => {
    expect(MAX_RETRIES).toBe(3);
  });

  it('dua kali 40001 lalu berhasil: fn dipanggil 3 kali, tiap percobaan transaksi baru', async () => {
    const { pools, sessions, connect } = fakePools();
    let calls = 0;
    const fn = vi.fn(() => {
      calls++;
      if (calls <= 2) return Promise.reject(sqlState('40001'));
      return Promise.resolve('ok');
    });

    await expect(withLedger(pools, USER, SPACE, fn)).resolves.toBe('ok');

    expect(fn).toHaveBeenCalledTimes(3);
    expect(connect).toHaveBeenCalledTimes(3);
    // Percobaan gagal di-rollback; yang berhasil di-commit. Konteks user + anggota tiap percobaan.
    expect(sessions.map((s) => s.at(-1))).toEqual(['rollback', 'rollback', 'commit']);
    for (const s of sessions) {
      expect(s[0]).toBe('begin');
      expect(s.some((q) => q.includes("set_config('app.user_id'"))).toBe(true);
      expect(s.some((q) => q.includes('app.assert_member'))).toBe(true);
    }
  });

  it('empat kali 40P01: melempar sesudah percobaan ke-4 (1 + 3 ulang)', async () => {
    const { pools, connect } = fakePools();
    const fn = vi.fn(() => Promise.reject(sqlState('40P01')));

    await expect(withLedger(pools, USER, SPACE, fn)).rejects.toMatchObject({ code: '40P01' });

    expect(fn).toHaveBeenCalledTimes(4);
    expect(connect).toHaveBeenCalledTimes(4);
  });

  it('galat lain (DK409) tidak diulang', async () => {
    const { pools } = fakePools();
    const fn = vi.fn(() =>
      Promise.reject(Object.assign(new Error('version_conflict'), { code: 'DK409' })),
    );

    await expect(withLedger(pools, USER, SPACE, fn)).rejects.toMatchObject({ code: 'DK409' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('40001 saat commit juga mengulang seluruh transaksi', async () => {
    const { pools, sessions } = fakePools();
    let commits = 0;
    const app = pools.app as unknown as { connect: () => Promise<pg.PoolClient> };
    const original = app.connect;
    app.connect = async () => {
      const client = await original();
      const query = client.query.bind(client) as (sql: string) => Promise<unknown>;
      (client as unknown as { query: (sql: string) => Promise<unknown> }).query = (sql) => {
        if (sql === 'commit' && ++commits === 1) return Promise.reject(sqlState('40001'));
        return query(sql);
      };
      return client;
    };
    const fn = vi.fn(() => Promise.resolve(42));

    await expect(withLedger(pools, USER, SPACE, fn)).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sessions).toHaveLength(2);
  });

  it('userId/spaceId bukan uuid ditolak sebelum menyentuh pool, tanpa ulang', async () => {
    const { pools, connect } = fakePools();
    const fn = vi.fn(() => Promise.resolve(1));
    await expect(withLedger(pools, 'bukan-uuid', SPACE, fn)).rejects.toThrow('userId bukan uuid');
    await expect(withLedger(pools, USER, 'bukan-uuid', fn)).rejects.toThrow('spaceId bukan uuid');
    expect(connect).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });
});
