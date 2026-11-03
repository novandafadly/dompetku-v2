import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { healthchecks } from '../alert';
import { jobDef, JOBS } from '../jobs';
import { closeAbandoned, runJob } from '../run-job';
import { startWorker, triggerJob, type WorkerHandle } from '../worker';

const WORKER_URL = process.env.TEST_WORKER_DATABASE_URL;
const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL;
if (!WORKER_URL || !ADMIN_URL) {
  throw new Error('TEST_WORKER_DATABASE_URL dan TEST_DATABASE_ADMIN_URL wajib diisi');
}

const quiet = () => undefined;
const dqJob = jobDef('dq_reconcile');

/** Server stub Healthchecks: mencatat path + body setiap ping. */
const pings: { path: string; body: string }[] = [];
const stub = http.createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c: string) => (body += c));
  req.on('end', () => {
    pings.push({ path: req.url ?? '', body });
    res.end('OK');
  });
});
let hcBase = '';

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });

async function lastRunId(): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    'select coalesce(max(id), 0)::text as id from jobs.job_runs',
  );
  return rows[0]?.id ?? '0';
}

async function runsSince(id: string, job: string) {
  const { rows } = await admin.query<{ status: string; error_code: string | null; rows: number }>(
    'select status, error_code, rows from jobs.job_runs where id > $1 and job = $2 order by id',
    [id, job],
  );
  return rows;
}

async function until(fn: () => Promise<boolean>, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('waktu tunggu habis');
}

beforeAll(async () => {
  stub.listen(0, '127.0.0.1');
  await once(stub, 'listening');
  hcBase = `http://127.0.0.1:${String((stub.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await pool.end();
  await admin.end();
  stub.close();
});

beforeEach(() => {
  pings.length = 0;
});

describe('hak role worker', () => {
  it('dompetku_worker tanpa CREATE database, punya CREATE hanya di skema pgboss', async () => {
    const { rows } = await pool.query<{ db: boolean; pgboss: boolean; app: boolean }>(
      `select has_database_privilege(current_user, current_database(), 'CREATE') as db,
              has_schema_privilege(current_user, 'pgboss', 'CREATE') as pgboss,
              has_schema_privilege(current_user, 'app', 'CREATE') as app`,
    );
    expect(rows[0]).toEqual({ db: false, pgboss: true, app: false });
  });
});

describe('runJob terhadap Postgres', () => {
  it('dq_reconcile di DB termigrasi → job_runs ok, stub menerima /start lalu ping sukses', async () => {
    const before = await lastRunId();
    const res = await runJob(pool, dqJob, healthchecks(`${hcBase}/dq`, { log: quiet }), {
      log: quiet,
    });
    expect(res).toMatchObject({ job: 'dq_reconcile', status: 'ok' });
    const runs = await runsSince(before, 'dq_reconcile');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('ok');
    expect(pings.map((p) => p.path)).toEqual(['/dq/start', '/dq']);
    // Body sukses hanya baris DQ07 (bila ada); tidak ada cek lain yang > 0.
    expect(pings[1]?.body).toMatch(/^(DQ07 warn \d+)?$/);
  });

  it('purge job memakai EXECUTE jobs.* → job_runs ok dengan rows', async () => {
    const before = await lastRunId();
    for (const name of ['purge_idempotency', 'purge_audit'] as const) {
      const res = await runJob(pool, jobDef(name), healthchecks(`${hcBase}/jobs`, { log: quiet }), {
        log: quiet,
      });
      expect(res).toMatchObject({ job: name, status: 'ok' });
      expect(await runsSince(before, name)).toEqual([{ status: 'ok', error_code: null, rows: 0 }]);
    }
    expect(pings.map((p) => `${p.path} ${p.body}`)).toEqual([
      '/jobs/start ',
      '/jobs job=purge_idempotency',
      '/jobs/start ',
      '/jobs job=purge_audit',
    ]);
  });

  it('DB mati (pool ke port mati) → failed, stub menerima /fail tanpa pesan galat', async () => {
    const dead = new pg.Pool({
      connectionString: 'postgres://dompetku_worker@127.0.0.1:1/dompetku',
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    try {
      const res = await runJob(dead, dqJob, healthchecks(`${hcBase}/dq`, { log: quiet }), {
        log: quiet,
      });
      expect(res).toEqual({ job: 'dq_reconcile', status: 'failed', code: 'unknown', rows: null });
    } finally {
      await dead.end();
    }
    expect(pings).toEqual([
      { path: '/dq/start', body: '' },
      { path: '/dq/fail', body: 'job=dq_reconcile code=unknown' },
    ]);
  });

  it('closeAbandoned menutup baris running > 1 jam saja', async () => {
    const { rows } = await admin.query<{ id: string; old: boolean }>(
      `insert into jobs.job_runs (job, status, started_at)
       values ('purge_audit', 'running', now() - interval '2 hours'),
              ('purge_audit', 'running', now() - interval '5 minutes')
       returning id::text, started_at < now() - interval '1 hour' as old`,
    );
    expect(await closeAbandoned(pool, { log: quiet })).toBeGreaterThanOrEqual(1);
    const { rows: after } = await admin.query<{ id: string; status: string; error_code: string }>(
      'select id::text, status, error_code from jobs.job_runs where id = any($1::bigint[]) order by id',
      [rows.map((r) => r.id)],
    );
    expect(after.map((r) => [r.status, r.error_code])).toEqual([
      ['failed', 'abandoned'],
      ['running', null],
    ]);
    await admin.query("update jobs.job_runs set status = 'failed' where id = $1", [
      rows.find((r) => !r.old)?.id,
    ]);
  });
});

describe('pg-boss (skema pgboss, createSchema: false)', () => {
  let w: WorkerHandle | undefined;

  afterAll(async () => {
    await w?.stop();
  });

  it('dua pemicu bersamaan untuk job yang sama → hanya satu yang jalan', async () => {
    const before = await lastRunId();
    w = await startWorker(
      { databaseUrl: WORKER_URL, hc: { dq: `${hcBase}/dq`, jobs: `${hcBase}/jobs` } },
      { log: quiet, pollingIntervalSeconds: 0.5 },
    );
    const ids = await Promise.all([
      triggerJob(w.boss, 'dq_reconcile'),
      triggerJob(w.boss, 'dq_reconcile'),
    ]);
    expect(ids.filter((id) => id !== null)).toHaveLength(1);
    await until(async () => (await runsSince(before, 'dq_reconcile')).length > 0);
    await until(() => Promise.resolve(pings.some((p) => p.path === '/dq')));
    // Beri waktu bila pemicu kedua ternyata ikut jalan.
    await new Promise((r) => setTimeout(r, 2000));
    const runs = await runsSince(before, 'dq_reconcile');
    expect(runs.map((r) => r.status)).toEqual(['ok']);
    expect(pings.filter((p) => p.path === '/dq/start')).toHaveLength(1);
  });

  it('jadwal terpasang di pgboss.schedule dengan tz Asia/Jakarta', async () => {
    const { rows } = await admin.query<{ name: string; cron: string; timezone: string }>(
      'select name, cron, timezone from pgboss.schedule order by name',
    );
    expect(rows).toEqual(
      [...JOBS]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((j) => ({ name: j.name, cron: j.cron, timezone: 'Asia/Jakarta' })),
    );
  });
});
