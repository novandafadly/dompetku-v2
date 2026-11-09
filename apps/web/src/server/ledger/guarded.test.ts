import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { guarded } from './guarded';

function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('guarded: savepoint kartu Beranda', () => {
  it('melempar ulang 40001, 40P01, DK401, dan DK404 space_not_found tanpa rollback savepoint lokal', async () => {
    for (const err of [
      pgError('40001', 'serialization_failure'),
      pgError('40P01', 'deadlock_detected'),
      pgError('DK401', 'unauthenticated'),
      pgError('DK404', 'space_not_found'),
    ]) {
      const queries: string[] = [];
      const client = {
        query: (sql: string) => {
          queries.push(sql);
          return Promise.resolve({ rows: [] });
        },
      } as unknown as pg.PoolClient;
      await expect(guarded(client, 'bills', () => Promise.reject(err))).rejects.toBe(err);
      expect(queries).toEqual(['savepoint beranda_bills']);
    }
  });

  it('menangkap DK404 level item (bukan space_not_found) dan galat SQL lain sebagai kartu error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const queries: string[] = [];
    const client = {
      query: (sql: string) => {
        queries.push(sql);
        return Promise.resolve({ rows: [] });
      },
    } as unknown as pg.PoolClient;
    const res = await guarded(client, 'bills', () =>
      Promise.reject(pgError('DK404', 'bill_not_found')),
    );
    expect(res).toBe('error');
    expect(queries).toEqual(['savepoint beranda_bills', 'rollback to savepoint beranda_bills']);
    expect(log).toHaveBeenCalledWith('[beranda] bills gagal dimuat: DK404');
    log.mockRestore();
  });
});
