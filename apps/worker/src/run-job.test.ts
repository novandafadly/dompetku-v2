import { describe, expect, it, vi } from 'vitest';
import type { Alerter } from './alert';
import { jobDef } from './jobs';
import type { LogFn } from './log';
import { closeAbandoned, errorCode, runJob, type Queryable } from './run-job';

const job = jobDef;

/** Pool palsu: mencatat SQL, menjawab per pola. */
function fakePool(answer: (sql: string) => unknown[] | Error) {
  const sqls: { sql: string; params: unknown[] }[] = [];
  const pool: Queryable = {
    query: vi.fn((sql: string, params?: unknown[]) => {
      sqls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params: params ?? [] });
      const a = answer(sql);
      return a instanceof Error ? Promise.reject(a) : Promise.resolve({ rows: a });
    }),
  };
  return { pool, sqls };
}

function fakeAlert() {
  const pings: string[] = [];
  const alert: Alerter = {
    start: vi.fn(() => (pings.push('start'), Promise.resolve())),
    ok: vi.fn((b: string) => (pings.push(`ok:${b}`), Promise.resolve())),
    fail: vi.fn((b: string) => (pings.push(`fail:${b}`), Promise.resolve())),
  };
  return { alert, pings };
}

function capture() {
  const lines: string[] = [];
  const log: LogFn = (event, fields) => lines.push(JSON.stringify({ event, ...fields }));
  return { lines, log };
}

const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });

const SWEEP = {
  sql:
    "update jobs.job_runs set status = 'failed', error_code = 'abandoned', finished_at = now()" +
    " where status = 'running' and started_at < now() - interval '1 hour' returning id",
  params: [],
};

const zeroDq = [
  'DQ01 error',
  'DQ03 error',
  'DQ04 error',
  'DQ04b error',
  'DQ06 warn',
  'DQ07 warn',
  'DQ09 error',
  'DQ10 warn',
  'DQ11 error',
  'DQ12 error',
].map((s) => {
  const [check_id, severity] = s.split(' ');
  return { check_id, severity, violations: 0 };
});

describe('runJob', () => {
  it('sukses: insert running → panggil job → update ok + rows; ping start lalu ok', async () => {
    const { pool, sqls } = fakePool((sql) =>
      sql.includes('insert into jobs.job_runs')
        ? [{ id: '7' }]
        : sql.includes('jobs.purge_audit()')
          ? [{ n: 3 }]
          : [],
    );
    const { alert, pings } = fakeAlert();
    const res = await runJob(pool, job('purge_audit'), alert, { log: () => undefined });
    expect(res).toEqual({ job: 'purge_audit', status: 'ok', rows: 3 });
    expect(sqls).toEqual([
      SWEEP,
      {
        sql: "insert into jobs.job_runs (job, status) values ($1, 'running') returning id",
        params: ['purge_audit'],
      },
      { sql: 'select jobs.purge_audit() as n', params: [] },
      {
        sql: "update jobs.job_runs set status = 'ok', finished_at = now(), rows = $2 where id = $1",
        params: ['7', 3],
      },
    ]);
    expect(pings).toEqual(['start', 'ok:job=purge_audit']);
  });

  it('galat 57014 → failed + error_code 57014, alert.fail tanpa isi pesan galat', async () => {
    const { pool, sqls } = fakePool((sql) =>
      sql.includes('insert into')
        ? [{ id: '8' }]
        : sql.includes('purge_voided')
          ? pgError('57014', 'canceling statement; Rp 1250000 kopi 2026')
          : [],
    );
    const { alert, pings } = fakeAlert();
    const { lines, log } = capture();
    const res = await runJob(pool, job('purge_voided'), alert, { log });
    expect(res).toEqual({ job: 'purge_voided', status: 'failed', code: '57014', rows: null });
    expect(sqls[3]).toEqual({
      sql: "update jobs.job_runs set status = 'failed', finished_at = now(), error_code = $2 where id = $1",
      params: ['8', '57014'],
    });
    expect(pings).toEqual(['start', 'fail:job=purge_voided code=57014']);
    expect(lines.join('\n')).not.toMatch(/1250000|kopi|canceling/);
  });

  it('insert job_runs gagal (DB mati) → failed, alert.fail, job tidak dipanggil', async () => {
    const { pool, sqls } = fakePool(() =>
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }),
    );
    const { alert, pings } = fakeAlert();
    const res = await runJob(pool, job('dq_reconcile'), alert, { log: () => undefined });
    expect(res).toEqual({ job: 'dq_reconcile', status: 'failed', code: 'unknown', rows: null });
    // Sapu lalu insert; keduanya gagal, fungsi job tidak pernah dipanggil.
    expect(sqls.map((q) => q.sql.slice(0, 22))).toEqual([
      'update jobs.job_runs s',
      'insert into jobs.job_r',
    ]);
    expect(pings).toEqual(['start', 'fail:job=dq_reconcile code=unknown']);
  });

  it('dq_reconcile semua 0 → ok, body kosong, job_runs ok rows 0', async () => {
    const { pool, sqls } = fakePool((sql) =>
      sql.includes('insert into') ? [{ id: '1' }] : sql.includes('dq_reconcile') ? zeroDq : [],
    );
    const { alert, pings } = fakeAlert();
    const res = await runJob(pool, job('dq_reconcile'), alert, { log: () => undefined });
    expect(res).toMatchObject({ job: 'dq_reconcile', status: 'ok', rows: 0, dq: 'ok' });
    expect(sqls[2]?.sql).toBe('select check_id, severity, violations from jobs.dq_reconcile()');
    expect(pings).toEqual(['start', 'ok:']);
  });

  it('dq_reconcile DQ10 warn 2 → fail("DQ10 warn 2"); job_runs tetap ok (job berjalan)', async () => {
    const rows = zeroDq.map((r) => (r.check_id === 'DQ10' ? { ...r, violations: 2 } : r));
    const { pool, sqls } = fakePool((sql) =>
      sql.includes('insert into') ? [{ id: '1' }] : sql.includes('dq_reconcile') ? rows : [],
    );
    const { alert, pings } = fakeAlert();
    const { lines, log } = capture();
    const res = await runJob(pool, job('dq_reconcile'), alert, { log });
    expect(res).toMatchObject({ status: 'ok', rows: 2, dq: 'fail' });
    expect(sqls[3]?.params).toEqual(['1', 2]);
    expect(pings).toEqual(['start', 'fail:DQ10 warn 2']);
    expect(lines.some((l) => l.includes('DQ10 warn 2'))).toBe(true);
  });

  it('baris DQ berbentuk aneh (id cek bukan DQxx) → failed unknown, isinya tidak bocor', async () => {
    const rows = [{ check_id: 'Rp 999999 sewa', severity: 'error', violations: 1 }];
    const { pool } = fakePool((sql) =>
      sql.includes('insert into') ? [{ id: '1' }] : sql.includes('dq_reconcile') ? rows : [],
    );
    const { alert, pings } = fakeAlert();
    const { lines, log } = capture();
    const res = await runJob(pool, job('dq_reconcile'), alert, { log });
    expect(res).toMatchObject({ status: 'failed', code: 'unknown' });
    expect(pings).toEqual(['start', 'fail:job=dq_reconcile code=unknown']);
    expect(lines.join('\n')).not.toMatch(/999999|sewa/);
  });

  it('sapu abandoned jalan di awal setiap job; galatnya dicatat tanpa menghentikan job', async () => {
    const { pool, sqls } = fakePool((sql) =>
      sql.includes("error_code = 'abandoned'")
        ? pgError('42501', 'permission denied')
        : sql.includes('insert into')
          ? [{ id: '5' }]
          : [{ n: 1 }],
    );
    const { alert, pings } = fakeAlert();
    const { lines, log } = capture();
    const res = await runJob(pool, job('purge_audit'), alert, { log });
    expect(res).toEqual({ job: 'purge_audit', status: 'ok', rows: 1 });
    expect(sqls[0]).toEqual(SWEEP);
    expect(sqls[1]?.sql).toContain('insert into jobs.job_runs');
    expect(lines[0]).toBe(
      JSON.stringify({ event: 'abandoned_sweep_failed', job: 'purge_audit', code: '42501' }),
    );
    expect(pings).toEqual(['start', 'ok:job=purge_audit']);
  });

  it('alert yang melempar tidak menggagalkan job', async () => {
    const { pool } = fakePool((sql) => (sql.includes('insert into') ? [{ id: '1' }] : [{ n: 0 }]));
    const alert: Alerter = {
      start: () => Promise.reject(new Error('x')),
      ok: () => Promise.reject(new Error('x')),
      fail: () => Promise.reject(new Error('x')),
    };
    const res = await runJob(pool, job('purge_idempotency'), alert, { log: () => undefined });
    expect(res.status).toBe('ok');
  });

  it('log dan alert tidak memuat angka mirip nominal (selain SQLSTATE dan tahun timestamp)', async () => {
    const all: string[] = [];
    const { lines, log } = capture();
    for (const [name, answer] of [
      ['purge_audit', pgError('23503', 'Rp 4500000 belanja 12345678')],
      ['purge_voided', pgError('DK500', 'invarian 7777777')],
      ['dq_reconcile', zeroDq.map((r) => ({ ...r, violations: r.check_id === 'DQ01' ? 4 : 0 }))],
    ] as const) {
      const { pool } = fakePool((sql) => (sql.includes('insert into') ? [{ id: '2' }] : answer));
      const { alert, pings } = fakeAlert();
      await runJob(pool, job(name), alert, { log });
      all.push(...pings);
    }
    all.push(...lines);
    const text = all
      .join('\n')
      .replace(/"t":"\d{4}-\d{2}-\d{2}T[\d:.]+Z"/g, '')
      .replace(/code=[0-9A-Z]{5}|"code":"[0-9A-Z]{5}"/g, '');
    expect(text).not.toMatch(/\d{4,}/);
    expect(text).toContain('DQ01 error 4');
  });
});

describe('errorCode', () => {
  it('SQLSTATE dipakai apa adanya', () => {
    expect(errorCode(pgError('57014', 'x'))).toBe('57014');
    expect(errorCode(pgError('DK500', 'x'))).toBe('DK500');
  });
  it('timeout klien → timeout', () => {
    expect(errorCode(new Error('Query read timeout'))).toBe('timeout');
    expect(errorCode(new Error('timeout exceeded when trying to connect'))).toBe('timeout');
    expect(errorCode(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe('timeout');
  });
  it('lainnya → unknown (kode Node bukan SQLSTATE, objek aneh)', () => {
    expect(errorCode(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe('unknown');
    expect(errorCode('string')).toBe('unknown');
    expect(errorCode(null)).toBe('unknown');
  });
});

describe('closeAbandoned', () => {
  it('menutup baris running > 1 jam sebagai failed/abandoned', async () => {
    const { pool, sqls } = fakePool(() => [{ id: '1' }, { id: '2' }]);
    const { lines, log } = capture();
    await expect(closeAbandoned(pool, { log })).resolves.toBe(2);
    expect(sqls).toEqual([
      {
        sql:
          "update jobs.job_runs set status = 'failed', error_code = 'abandoned', finished_at = now()" +
          " where status = 'running' and started_at < now() - interval '1 hour' returning id",
        params: [],
      },
    ]);
    expect(lines).toEqual([JSON.stringify({ event: 'abandoned_closed', count: 2 })]);
  });
});
