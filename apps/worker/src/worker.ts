import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { healthchecks } from './alert';
import type { Config } from './config';
import { JOBS, type JobName } from './jobs';
import type { LogFn } from './log';
import { log as defaultLog } from './log';
import { closeAbandoned, errorCode, runJob } from './run-job';

export interface WorkerHandle {
  boss: PgBoss;
  pool: pg.Pool;
  stop(): Promise<void>;
}

export interface WorkerOptions {
  log?: LogFn;
  /** Poll antrean pg-boss; job harian, jadi 10 s cukup. Tes memakai nilai kecil. */
  pollingIntervalSeconds?: number;
}

/**
 * Kebijakan `exclusive` + singletonKey = nama job: paling banyak satu job per nama yang antre
 * atau aktif, lintas instance worker. Pemicu kedua ditolak pg-boss (send → null).
 * retryLimit 0: job gagal sudah dicatat dan di-alert; besok jadwal berikutnya.
 */
const QUEUE = { policy: 'exclusive', retryLimit: 0, expireInSeconds: 600 } as const;

export function triggerJob(boss: PgBoss, name: JobName): Promise<string | null> {
  return boss.send(name, null, { singletonKey: name });
}

export async function startWorker(cfg: Config, opts: WorkerOptions = {}): Promise<WorkerHandle> {
  const log = opts.log ?? defaultLog;

  // Pool job terpisah dari pool pg-boss; tanpa SET sesi (timeout dari ALTER ROLE dompetku_worker).
  const pool = new pg.Pool({
    connectionString: cfg.databaseUrl,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Sabuk pengaman di atas statement_timeout role (60 s): koneksi macet → `timeout`.
    query_timeout: 90_000,
    application_name: 'dompetku-worker-job',
  });
  pool.on('error', (err) => {
    log('pool_error', { code: errorCode(err) });
  });

  const boss = new PgBoss({
    connectionString: cfg.databaseUrl,
    schema: 'pgboss',
    // Skema pgboss dibuat migrasi 0112 (milik dompetku_owner); worker tidak punya CREATE database,
    // jadi `CREATE SCHEMA IF NOT EXISTS` bawaan pg-boss harus dimatikan. Tabelnya dibuat worker.
    createSchema: false,
    max: 2,
    application_name: 'dompetku-worker',
  });
  boss.on('error', (err) => {
    log('boss_error', { code: errorCode(err) });
  });

  try {
    await closeAbandoned(pool, { log });
    await boss.start();
    for (const job of JOBS) {
      await boss.createQueue(job.name, QUEUE);
      await boss.schedule(job.name, job.cron, null, {
        tz: job.tz,
        singletonKey: job.name,
        // Worker mati saat jadwal lewat (deploy): kirim sekali untuk kejadian terakhir.
        missed: 'once',
      });
      const alert = healthchecks(cfg.hc[job.check], { log, check: job.check });
      await boss.work(
        job.name,
        { pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 10 },
        async () => {
          // runJob tidak melempar; hasilnya tidak disimpan di pgboss.job.output.
          await runJob(pool, job, alert, { log });
        },
      );
    }
  } catch (err) {
    await boss.stop({ graceful: false }).catch(() => undefined);
    await pool.end().catch(() => undefined);
    throw err;
  }

  return {
    boss,
    pool,
    async stop() {
      await boss.stop({ graceful: true });
      await pool.end();
    },
  };
}
