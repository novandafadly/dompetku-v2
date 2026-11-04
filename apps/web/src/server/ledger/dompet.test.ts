import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  queries: [] as string[],
  openTx: vi.fn(() => Promise.resolve([{ entryId: 'e1' }])),
}));
vi.mock('./retry', () => ({
  withLedger: (_p: unknown, _u: unknown, _s: unknown, fn: (c: pg.PoolClient) => Promise<unknown>) =>
    fn({
      query: (sql: string) => {
        mocks.queries.push(sql);
        return Promise.resolve({ rows: [] });
      },
    } as unknown as pg.PoolClient),
}));
vi.mock('./reimburse', () => ({ openReimbursablesTx: mocks.openTx }));

import { loadDompetDaftar } from './dompet';

const ctx = { pools: {} as never, userId: 'u', spaceId: 's' };

describe('loadDompetDaftar: Menunggu reimburse hanya di Pribadi', () => {
  it('Pribadi memuat talangan terbuka', async () => {
    mocks.openTx.mockClear();
    const d = await loadDompetDaftar(ctx, 'personal');
    expect(mocks.openTx).toHaveBeenCalledTimes(1);
    expect(d.reimbursables).toEqual([{ entryId: 'e1' }]);
  });

  it('Bersama tidak pernah memanggil kueri talangan (data tidak dimuat sama sekali)', async () => {
    mocks.openTx.mockClear();
    mocks.queries.length = 0;
    const d = await loadDompetDaftar(ctx, 'shared');
    expect(mocks.openTx).not.toHaveBeenCalled();
    expect(mocks.queries.join('\n')).not.toContain('open_reimbursables');
    expect(d.reimbursables).toEqual([]);
  });
});
