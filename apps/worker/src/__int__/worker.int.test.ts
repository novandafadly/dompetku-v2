import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { healthchecks } from '../alert';
import { jobDef, JOBS } from '../jobs';
import { ProviderError, StubPriceSource } from '../price-source';
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
    for (const name of ['purge_idempotency', 'purge_audit', 'purge_wa_messages'] as const) {
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
      '/jobs/start ',
      '/jobs job=purge_wa_messages',
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

  it('runJob menyapu baris running > 1 jam sebelum menjalankan job (tanpa restart worker)', async () => {
    const { rows } = await admin.query<{ id: string }>(
      `insert into jobs.job_runs (job, status, started_at)
       values ('dq_reconcile', 'running', now() - interval '3 hours') returning id::text`,
    );
    const stale = rows[0]?.id;
    const res = await runJob(pool, jobDef('purge_audit'), healthchecks(undefined, { log: quiet }), {
      log: quiet,
    });
    expect(res.status).toBe('ok');
    const { rows: after } = await admin.query<{ status: string; error_code: string | null }>(
      'select status, error_code from jobs.job_runs where id = $1',
      [stale],
    );
    expect(after).toEqual([{ status: 'failed', error_code: 'abandoned' }]);
  });
});

describe('materialize_bills (S9, K3)', () => {
  const job = jobDef('materialize_bills');
  const uid = '0b0b0b0b-0000-4000-8000-000000000001';
  const email = 'worker-int@example.test';
  let billId = '';
  let ownerEmail: string | null = null;

  async function occurrences(): Promise<number> {
    const { rows } = await admin.query<{ n: number }>(
      'select count(*)::int as n from app.bill_occurrences where bill_id = $1',
      [billId],
    );
    return rows[0]?.n ?? -1;
  }

  beforeAll(async () => {
    // Satu rumah tangga lewat jalan produksi (trigger pendaftaran, api.bootstrap_owner,
    // api.create_bill), lalu kemunculan dihapus agar job yang membuatnya lagi.
    const { rows: prev } = await admin.query<{ value: string }>(
      "select value from app.settings where key = 'owner_email'",
    );
    ownerEmail = prev[0]?.value ?? null;
    const c = await admin.connect();
    try {
      await c.query('begin');
      await c.query(
        `insert into app.settings (key, value) values ('owner_email', $1)
         on conflict (key) do update set value = excluded.value`,
        [email],
      );
      await c.query(
        'insert into auth."user" (id, name, email, "emailVerified") values ($1, \'Tes\', $2, true)',
        [uid, email],
      );
      await c.query(
        "insert into auth.recovery_codes (user_id, code_hash) values ($1, '$argon2id$v=19$tes')",
        [uid],
      );
      await c.query("select set_config('app.user_id', $1, true)", [uid]);
      await c.query("select api.bootstrap_owner('Tes')");
      const { rows } = await c.query<{ id: string }>(
        `select (api.create_bill(gen_random_uuid(), s.id, 'Listrik', 485000, k.id, 28::smallint,
                 app.today()) ->> 'bill_id') as id
         from app.spaces s join app.categories k on k.space_id = s.id and k.name = 'Listrik & Air'
         where s.kind = 'shared'`,
      );
      billId = rows[0]?.id ?? '';
      await c.query('delete from app.bill_occurrences where bill_id = $1', [billId]);
      await c.query('commit');
    } catch (err) {
      await c.query('rollback');
      throw err;
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    // DB kembali bersih untuk tes integrasi web (pola wipe() di harness web).
    await admin.query(`
      begin;
      select set_config('dompetku.purge', 'on', true);
      delete from app.idempotency_keys;
      delete from app.bill_occurrences;
      delete from app.bills;
      delete from app.budgets;
      delete from app.goals;
      delete from app.categories;
      delete from app.space_members;
      delete from app.profiles;
      delete from app.spaces;
      delete from app.households;
      delete from audit.events;
      delete from auth."user";
      commit;`);
    if (ownerEmail === null) {
      await admin.query("delete from app.settings where key = 'owner_email'");
    } else {
      await admin.query("update app.settings set value = $1 where key = 'owner_email'", [
        ownerEmail,
      ]);
    }
  });

  it('dua kali jalan → baris bill_occurrences sama, job_runs dua ok', async () => {
    expect(billId).not.toBe('');
    expect(await occurrences()).toBe(0);
    const before = await lastRunId();
    const hc = healthchecks(`${hcBase}/jobs`, { log: quiet });
    const first = await runJob(pool, job, hc, { log: quiet });
    const afterFirst = await occurrences();
    const second = await runJob(pool, job, hc, { log: quiet });
    expect(afterFirst).toBeGreaterThan(0);
    expect(first).toEqual({ job: 'materialize_bills', status: 'ok', rows: afterFirst });
    expect(second).toEqual({ job: 'materialize_bills', status: 'ok', rows: 0 });
    expect(await occurrences()).toBe(afterFirst);
    expect(await runsSince(before, 'materialize_bills')).toEqual([
      { status: 'ok', error_code: null, rows: afterFirst },
      { status: 'ok', error_code: null, rows: 0 },
    ]);
    expect(pings.map((p) => `${p.path} ${p.body}`)).toEqual([
      '/jobs/start ',
      '/jobs job=materialize_bills',
      '/jobs/start ',
      '/jobs job=materialize_bills',
    ]);
  });

  it('gagal (EXECUTE dicabut sementara) → job_runs failed 42501, /fail tanpa nominal', async () => {
    const before = await lastRunId();
    await admin.query(
      'revoke execute on function jobs.materialize_bills(date) from dompetku_worker',
    );
    try {
      const res = await runJob(pool, job, healthchecks(`${hcBase}/jobs`, { log: quiet }), {
        log: quiet,
      });
      expect(res).toEqual({
        job: 'materialize_bills',
        status: 'failed',
        code: '42501',
        rows: null,
      });
    } finally {
      await admin.query(
        'grant execute on function jobs.materialize_bills(date) to dompetku_worker',
      );
    }
    expect(await runsSince(before, 'materialize_bills')).toEqual([
      { status: 'failed', error_code: '42501', rows: null },
    ]);
    expect(pings).toEqual([
      { path: '/jobs/start', body: '' },
      { path: '/jobs/fail', body: 'job=materialize_bills code=42501' },
    ]);
    expect(pings.some((p) => p.body.includes('485'))).toBe(false);
  });
});

describe('S14: net_worth_snapshot, price_refresh (StubPriceSource), DQ08/18/19', () => {
  const uid = '0b0b0b0b-0000-4000-8000-000000000014';
  const email = 'worker-int-s14@example.test';
  // Selasa 2026-11-10 17:00 WIB (sesudah tutup bursa). Jam hanya bisa diganti di env dev/test.
  const TUE = '2026-11-10';
  let ownerEmail: string | null = null;
  let env = 'prod';
  let personal = '';
  const pools: pg.Pool[] = [];
  const hc = () => healthchecks(`${hcBase}/jobs`, { log: quiet });
  const priceJob = jobDef('price_refresh');

  /** Pool worker dengan jam app.now() dipatok (sesi; hanya berlaku di env test). */
  function workerAt(at: string): pg.Pool {
    const p = new pg.Pool({
      connectionString: WORKER_URL,
      max: 1,
      options: `-c app.now_override=${at.replace(' ', 'T')}`,
    });
    pools.push(p);
    return p;
  }
  const echo = (close: number) =>
    new StubPriceSource((t) => t.map((ticker) => ({ ticker, close })));

  async function prices() {
    const { rows } = await admin.query<{
      on: string;
      close: string;
      source: string;
      status: string;
    }>(
      `select on_date::text as on, close::text, source, status from app.stock_prices
        where space_id = $1 order by on_date`,
      [personal],
    );
    return rows;
  }
  async function clearPriceRuns() {
    await admin.query("delete from jobs.job_runs where job = 'price_refresh'");
  }

  beforeAll(async () => {
    const { rows: prev } = await admin.query<{ key: string; value: string }>(
      "select key, value from app.settings where key in ('owner_email', 'env')",
    );
    ownerEmail = prev.find((r) => r.key === 'owner_email')?.value ?? null;
    env = prev.find((r) => r.key === 'env')?.value ?? 'prod';
    const c = await admin.connect();
    try {
      await c.query('begin');
      await c.query("update app.settings set value = 'test' where key = 'env'");
      await c.query(
        `insert into app.settings (key, value) values ('owner_email', $1)
         on conflict (key) do update set value = excluded.value`,
        [email],
      );
      await c.query(
        'insert into auth."user" (id, name, email, "emailVerified") values ($1, \'Tes\', $2, true)',
        [uid, email],
      );
      await c.query(
        "insert into auth.recovery_codes (user_id, code_hash) values ($1, '$argon2id$v=19$tes')",
        [uid],
      );
      await c.query("select set_config('app.user_id', $1, true)", [uid]);
      await c.query("select api.bootstrap_owner('Tes')");
      const { rows } = await c.query<{ id: string }>(
        "select id from app.spaces where kind = 'personal'",
      );
      personal = rows[0]?.id ?? '';
      // Dompet saham + saham berjalan 100 lembar (biaya 9000) sejak 2 Nov lewat jalan produksi.
      const { rows: acc } = await c.query<{ id: string }>(
        `select (api.create_account(gen_random_uuid(), $1, 'Saham', 'aset', null, '2026-11-01', 0,
                 'saham') ->> 'account_id') as id`,
        [personal],
      );
      await c.query(
        `select api.open_stock_holding(p_client_id => gen_random_uuid(), p_account_id => $1,
                p_ticker => 'BBCA', p_shares => 100, p_price => 9000, p_on => '2026-11-02')`,
        [acc[0]?.id],
      );
      await c.query('commit');
    } catch (err) {
      await c.query('rollback');
      throw err;
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
    await clearPriceRuns();
    await admin.query(`
      begin;
      select set_config('dompetku.purge', 'on', true);
      insert into private.stock_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
      delete from app.idempotency_keys;
      delete from app.entry_lines;
      delete from app.entry_history;
      delete from app.entries;
      delete from app.stock_trades;
      delete from app.stock_holdings;
      delete from app.stock_prices;
      delete from app.asset_details;
      delete from app.net_worth_snapshots;
      delete from app.nw_dirty;
      delete from app.accounts;
      delete from app.categories;
      delete from app.space_members;
      delete from app.profiles;
      delete from app.spaces;
      delete from app.households;
      delete from audit.events;
      delete from auth."user";
      delete from app.holidays where name = 'Uji worker';
      delete from private.stock_ctx where xid = pg_catalog.pg_current_xact_id();
      commit;`);
    await admin.query("update app.settings set value = $1 where key = 'env'", [env]);
    if (ownerEmail === null) {
      await admin.query("delete from app.settings where key = 'owner_email'");
    } else {
      await admin.query("update app.settings set value = $1 where key = 'owner_email'", [
        ownerEmail,
      ]);
    }
  });

  it('net_worth_snapshot: backfill sejak entri tertua sampai H−1, run kedua idempoten', async () => {
    const job = jobDef('net_worth_snapshot');
    const count = async () =>
      (
        await admin.query<{ n: number; first: string }>(
          `select count(*)::int as n, min(on_date)::text as first from app.net_worth_snapshots
            where space_id = $1`,
          [personal],
        )
      ).rows[0];
    const first = await runJob(pool, job, hc(), { log: quiet });
    expect(first).toMatchObject({ job: 'net_worth_snapshot', status: 'ok' });
    const after = await count();
    expect(after?.first).toBe('2026-11-02');
    expect(after?.n).toBeGreaterThan(1);
    const { rows: sp } = await admin.query<{ n: number }>(
      'select count(*)::int as n from app.spaces',
    );
    // Run kedua: tanpa hari kotor, hanya H−1 per ruang dihitung ulang; isi tabel tetap.
    const second = await runJob(pool, job, hc(), { log: quiet });
    expect(second).toEqual({ job: 'net_worth_snapshot', status: 'ok', rows: sp[0]?.n });
    expect(await count()).toEqual(after);
    expect(pings.map((p) => `${p.path} ${p.body}`)).toEqual([
      '/jobs/start ',
      '/jobs job=net_worth_snapshot',
      '/jobs/start ',
      '/jobs job=net_worth_snapshot',
    ]);
  });

  it('price_refresh: harga hari itu masuk per ruang pemegang; run 19:30 tidak memanggil sumber lagi', async () => {
    await clearPriceRuns();
    const w = workerAt(`${TUE} 17:00+07`);
    const src = echo(9875);
    const first = await runJob(w, priceJob, hc(), { log: quiet, priceSource: src });
    expect(first).toEqual({ job: 'price_refresh', status: 'ok', rows: 1 });
    expect(src.calls).toEqual([{ tickers: ['BBCA'], on: TUE }]);
    expect(await prices()).toEqual([{ on: TUE, close: '9875', source: 'provider', status: 'ok' }]);

    const lines: string[] = [];
    const second = await runJob(workerAt(`${TUE} 19:30+07`), priceJob, hc(), {
      log: (e, f) => lines.push(JSON.stringify({ e, ...f })),
      priceSource: src,
    });
    expect(second).toEqual({ job: 'price_refresh', status: 'ok', rows: 0 });
    expect(src.calls).toHaveLength(1);
    expect(lines).toContain(
      JSON.stringify({ e: 'price_skipped', job: 'price_refresh', reason: 'done_today' }),
    );
    expect(pings.some((p) => p.body.includes('BBCA') || p.body.includes('9875'))).toBe(false);
  });

  it('price_refresh: sebelum 16:15 WIB (run terlewat/manual pagi) tidak menyimpan harga berjalan dan tidak mengunci hari itu', async () => {
    await clearPriceRuns();
    const src = echo(9875);
    const before = await prices();
    const lines: string[] = [];
    const early = await runJob(workerAt(`${TUE} 09:05+07`), priceJob, hc(), {
      log: (e, f) => lines.push(JSON.stringify({ e, ...f })),
      priceSource: src,
    });
    expect(early).toEqual({ job: 'price_refresh', status: 'ok', rows: 0 });
    expect(src.calls).toEqual([]);
    expect(await prices()).toEqual(before);
    expect(lines).toContain(
      JSON.stringify({ e: 'price_skipped', job: 'price_refresh', reason: 'before_close' }),
    );
    const later = await runJob(workerAt(`${TUE} 16:30+07`), priceJob, hc(), {
      log: quiet,
      priceSource: src,
    });
    expect(later).toEqual({ job: 'price_refresh', status: 'ok', rows: 1 });
    expect(await prices()).toEqual([{ on: TUE, close: '9875', source: 'provider', status: 'ok' }]);
  });

  it('price_refresh: Sabtu dan hari di app.holidays dilewati tanpa memanggil sumber', async () => {
    await admin.query(
      "insert into app.holidays (on_date, name, kind) values ('2026-11-12', 'Uji worker', 'libur')",
    );
    for (const at of ['2026-11-14 17:00+07', '2026-11-12 17:00+07']) {
      await clearPriceRuns();
      const src = echo(9900);
      const lines: string[] = [];
      const res = await runJob(workerAt(at), priceJob, hc(), {
        log: (e, f) => lines.push(JSON.stringify({ e, ...f })),
        priceSource: src,
      });
      expect(res, at).toEqual({ job: 'price_refresh', status: 'ok', rows: 0 });
      expect(src.calls, at).toEqual([]);
      expect(lines, at).toContain(
        JSON.stringify({ e: 'price_skipped', job: 'price_refresh', reason: 'market_closed' }),
      );
    }
    await admin.query("delete from app.holidays where name = 'Uji worker'");
  });

  it('price_refresh: galat penyedia → failed provider_*, harga lama tetap; lonjakan → held', async () => {
    await clearPriceRuns();
    const before = await lastRunId();
    const w = workerAt('2026-11-11 17:00+07');
    const broken = new StubPriceSource(() => {
      throw new ProviderError('provider_timeout');
    });
    const res = await runJob(w, priceJob, hc(), { log: quiet, priceSource: broken });
    expect(res).toEqual({
      job: 'price_refresh',
      status: 'failed',
      code: 'provider_timeout',
      rows: null,
    });
    expect(await runsSince(before, 'price_refresh')).toEqual([
      { status: 'failed', error_code: 'provider_timeout', rows: null },
    ]);
    expect(pings.at(-1)).toEqual({
      path: '/jobs/fail',
      body: 'job=price_refresh code=provider_timeout',
    });
    expect(await prices()).toEqual([{ on: TUE, close: '9875', source: 'provider', status: 'ok' }]);

    // Run 19:30 sesudah gagal tetap mencoba; +100 % dari harga ok terakhir = held (K8).
    const spike = await runJob(workerAt('2026-11-11 19:30+07'), priceJob, hc(), {
      log: quiet,
      priceSource: echo(19750),
    });
    expect(spike).toEqual({ job: 'price_refresh', status: 'ok', rows: 1 });
    expect((await prices()).at(-1)).toEqual({
      on: '2026-11-11',
      close: '19750',
      source: 'provider',
      status: 'held',
    });
  });

  it('snapshot H−1 memakai harga ok terakhir (held tidak dipakai); dq_reconcile tanpa DQ08/18/19', async () => {
    // Hari kotor dari koreksi harga/entri susulan diuji pgTAP 42_kekayaan; harga penyedia selalu
    // bertanggal hari ini (bukan hari kotor), jadi masuk snapshot H−1 keesokan harinya.
    await runJob(pool, jobDef('net_worth_snapshot'), hc(), { log: quiet });
    const { rows } = await admin.query<{ on: string; saham: string }>(
      `select on_date::text as on, saham_pasar::text as saham from app.net_worth_snapshots
        where space_id = $1 and on_date in ('2026-11-09', app.today() - 1) order by on_date`,
      [personal],
    );
    // 9 Nov sebelum harga pertama = biaya perolehan; H−1 = 100 × 9875 (bukan held 19750).
    expect(rows.map((r) => r.saham)).toEqual(['900000', '987500']);
    pings.length = 0;
    const dq = await runJob(pool, dqJob, healthchecks(`${hcBase}/dq`, { log: quiet }), {
      log: quiet,
    });
    expect(dq).toMatchObject({ status: 'ok', dq: 'ok' });
    expect(pings.at(-1)?.body ?? '').not.toMatch(/DQ08|DQ18|DQ19/);
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
