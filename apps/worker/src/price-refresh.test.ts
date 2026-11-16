import { describe, expect, it, vi } from 'vitest';
import type { Alerter } from './alert';
import { jobDef } from './jobs';
import type { LogFn } from './log';
import { refreshPrices } from './price-refresh';
import { ProviderError, StubPriceSource } from './price-source';
import { runJob, type Queryable } from './run-job';

interface DbState {
  closed?: boolean;
  done?: boolean;
  targets?: string[];
}

/** Pool palsu: state hari ini, price_targets, price_ingest (mencatat larik yang dikirim). */
function fakeDb(st: DbState = {}) {
  const ingested: { on: unknown; rows: unknown }[] = [];
  const query = vi.fn((sql: string, params?: unknown[]) => {
    if (sql.includes('app.today()::text as on')) {
      return Promise.resolve({
        rows: [{ on: '2026-11-10', closed: st.closed ?? false, done: st.done ?? false }],
      });
    }
    if (sql.includes('jobs.price_targets()')) {
      return Promise.resolve({ rows: (st.targets ?? ['BBCA']).map((ticker) => ({ ticker })) });
    }
    if (sql.includes('jobs.price_ingest')) {
      const rows = JSON.parse(String(params?.[1])) as unknown[];
      ingested.push({ on: params?.[0], rows });
      return Promise.resolve({
        rows: [{ r: { ok: rows.length, held: 0, rejected: 0, skipped: 0 } }],
      });
    }
    if (sql.includes('insert into jobs.job_runs')) return Promise.resolve({ rows: [{ id: '9' }] });
    return Promise.resolve({ rows: [] });
  });
  const pool: Queryable = { query };
  return { pool, query, ingested };
}

function capture() {
  const lines: string[] = [];
  const log: LogFn = (event, fields) => lines.push(JSON.stringify({ event, ...fields }));
  return { lines, log };
}

const quiet: LogFn = () => undefined;
const echo = () => new StubPriceSource((t) => t.map((ticker) => ({ ticker, close: 9875 })));

describe('refreshPrices', () => {
  it('price_targets → sumber (tanggal WIB) → price_ingest; rows = ok + held', async () => {
    const { pool, ingested } = fakeDb({ targets: ['BBCA', 'TLKM'] });
    const src = echo();
    const { lines, log } = capture();
    expect(await refreshPrices(pool, src, log)).toBe(2);
    expect(src.calls).toEqual([{ tickers: ['BBCA', 'TLKM'], on: '2026-11-10' }]);
    expect(ingested).toEqual([
      {
        on: '2026-11-10',
        rows: [
          { ticker: 'BBCA', close: 9875 },
          { ticker: 'TLKM', close: 9875 },
        ],
      },
    ]);
    expect(lines).toEqual([
      JSON.stringify({
        event: 'price_ingested',
        job: 'price_refresh',
        targets: 2,
        prices: { ok: 2, held: 0, rejected: 0, skipped: 0 },
      }),
    ]);
  });

  it('lebih dari 100 kode dipecah per 100', async () => {
    const targets = Array.from({ length: 205 }, (_, i) =>
      String.fromCharCode(65 + (Math.floor(i / 26) % 26), 65 + (i % 26), 65, 65),
    );
    const { pool, ingested } = fakeDb({ targets });
    const src = echo();
    expect(await refreshPrices(pool, src, quiet)).toBe(205);
    expect(src.calls.map((c) => c.tickers.length)).toEqual([100, 100, 5]);
    expect(ingested.map((i) => (i.rows as unknown[]).length)).toEqual([100, 100, 5]);
  });

  it('bursa tutup (akhir pekan / app.holidays) atau harga hari ini sudah ada → tanpa sumber', async () => {
    for (const [st, reason] of [
      [{ closed: true }, 'market_closed'],
      [{ done: true }, 'done_today'],
    ] as const) {
      const { pool, ingested } = fakeDb(st);
      const src = echo();
      const { lines, log } = capture();
      expect(await refreshPrices(pool, src, log)).toBe(0);
      expect(src.calls).toEqual([]);
      expect(ingested).toEqual([]);
      expect(lines).toEqual([
        JSON.stringify({ event: 'price_skipped', job: 'price_refresh', reason }),
      ]);
    }
  });

  it('tanpa kode dipegang → sumber tidak dipanggil', async () => {
    const { pool } = fakeDb({ targets: [] });
    const src = echo();
    expect(await refreshPrices(pool, src, quiet)).toBe(0);
    expect(src.calls).toEqual([]);
  });

  it('kode yang tidak diminta dibuang; jawaban kosong tidak memanggil price_ingest', async () => {
    const { pool, ingested } = fakeDb({ targets: ['BBCA'] });
    await refreshPrices(
      pool,
      new StubPriceSource(() => [
        { ticker: 'BBCA', close: 1 },
        { ticker: 'ZZZZ', close: 2 },
      ]),
      quiet,
    );
    expect(ingested[0]?.rows).toEqual([{ ticker: 'BBCA', close: 1 }]);
    const empty = fakeDb({ targets: ['BBCA'] });
    expect(await refreshPrices(empty.pool, new StubPriceSource(() => []), quiet)).toBe(0);
    expect(empty.ingested).toEqual([]);
  });

  it('jawaban sumber berbentuk salah → provider_shape (nilai diserahkan ke validasi SQL)', async () => {
    const { pool, ingested } = fakeDb();
    const bad = new StubPriceSource(() => [{ ticker: 'BBCA', close: '9875' }] as never);
    await expect(refreshPrices(pool, bad, quiet)).rejects.toMatchObject({ code: 'provider_shape' });
    expect(ingested).toEqual([]);
  });

  it('tidak memanggil fetch global (sumber stub)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await refreshPrices(fakeDb().pool, echo(), quiet);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

function fakeAlert() {
  const pings: string[] = [];
  const alert: Alerter = {
    start: vi.fn(() => (pings.push('start'), Promise.resolve())),
    ok: vi.fn((b: string) => (pings.push(`ok:${b}`), Promise.resolve())),
    fail: vi.fn((b: string) => (pings.push(`fail:${b}`), Promise.resolve())),
  };
  return { alert, pings };
}

describe('runJob price_refresh', () => {
  const job = jobDef('price_refresh');

  it('tanpa sumber (PRICE_PROVIDER kosong) → skipped: tanpa SQL, tanpa ping', async () => {
    const { pool, query } = fakeDb();
    const { alert, pings } = fakeAlert();
    const { lines, log } = capture();
    expect(await runJob(pool, job, alert, { log })).toEqual({
      job: 'price_refresh',
      status: 'skipped',
      rows: null,
    });
    expect(query).not.toHaveBeenCalled();
    expect(pings).toEqual([]);
    expect(lines).toEqual([
      JSON.stringify({ event: 'job_skipped', job: 'price_refresh', reason: 'no_provider' }),
    ]);
  });

  it('sukses → job_runs ok dengan jumlah harga, ping ok', async () => {
    const { pool, query } = fakeDb({ targets: ['BBCA', 'TLKM'] });
    const { alert, pings } = fakeAlert();
    const res = await runJob(pool, job, alert, { log: quiet, priceSource: echo() });
    expect(res).toEqual({ job: 'price_refresh', status: 'ok', rows: 2 });
    expect(pings).toEqual(['start', 'ok:job=price_refresh']);
    expect(query).toHaveBeenCalledWith(
      "update jobs.job_runs set status = 'ok', finished_at = now(), rows = $2 where id = $1",
      ['9', 2],
    );
  });

  it('galat penyedia → failed dengan kode singkat; log, job_runs, dan ping tanpa URL/kunci', async () => {
    for (const c of ['provider_timeout', 'provider_http_4xx', 'provider_too_large'] as const) {
      const { pool, query, ingested } = fakeDb();
      const { alert, pings } = fakeAlert();
      const { lines, log } = capture();
      const src = new StubPriceSource(() => {
        throw Object.assign(new ProviderError(c), {
          cause: new Error('GET https://harga.test/v1?apikey=KUNCI-RAHASIA gagal'),
        });
      });
      const res = await runJob(pool, job, alert, { log, priceSource: src });
      expect(res).toEqual({ job: 'price_refresh', status: 'failed', code: c, rows: null });
      expect(ingested).toEqual([]);
      expect(pings).toEqual(['start', `fail:job=price_refresh code=${c}`]);
      expect(query).toHaveBeenCalledWith(
        "update jobs.job_runs set status = 'failed', finished_at = now(), error_code = $2 where id = $1",
        ['9', c],
      );
      const all = [...lines, ...pings].join('\n');
      expect(all).not.toMatch(/KUNCI|harga\.test|apikey|BBCA/);
    }
  });

  it('galat tak dikenal dari adapter → unknown, pesan tidak diteruskan', async () => {
    const { pool } = fakeDb();
    const { alert, pings } = fakeAlert();
    const { lines, log } = capture();
    const src = new StubPriceSource(() => {
      throw new Error('https://harga.test/?token=KUNCI-RAHASIA');
    });
    const res = await runJob(pool, job, alert, { log, priceSource: src });
    expect(res).toMatchObject({ status: 'failed', code: 'unknown' });
    expect([...lines, ...pings].join('\n')).not.toMatch(/KUNCI|harga\.test/);
  });
});
