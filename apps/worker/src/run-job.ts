import { z } from 'zod';
import type { Alerter } from './alert';
import { dqVerdict, type JobDef, type JobName } from './jobs';
import type { LogFn } from './log';
import { log as defaultLog } from './log';

/** Bagian pg.Pool yang dipakai; memudahkan pool palsu di tes unit. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export type JobResult =
  | { job: JobName; status: 'ok'; rows: number; dq?: 'ok' | 'fail' }
  | { job: JobName; status: 'failed'; code: string; rows: null };

interface RunOptions {
  log?: LogFn;
}

const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Kode galat untuk job_runs, log, dan alert: SQLSTATE, `timeout`, atau `unknown`.
 * `err.message` hanya dibaca untuk mengenali timeout klien pg, tidak pernah diteruskan.
 */
export function errorCode(err: unknown): string {
  if (typeof err !== 'object' || err === null) return 'unknown';
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && SQLSTATE.test(code)) return code;
  if (code === 'ETIMEDOUT') return 'timeout';
  const message = (err as { message?: unknown }).message;
  if (typeof message === 'string' && /timeout/i.test(message)) return 'timeout';
  return 'unknown';
}

const IdRows = z.array(z.object({ id: z.string() })).length(1);
const CountRows = z.array(z.object({ n: z.number().int().min(0) })).length(1);
const DqRows = z
  .array(
    z.object({
      check_id: z.string().regex(/^DQ[0-9]{2}[a-z]?$/),
      severity: z.enum(['error', 'warn']),
      violations: z.number().int().min(0),
    }),
  )
  .min(1);

/** Bentuk keluaran tidak sesuai kontrak: dicatat sebagai `unknown` tanpa isinya. */
class ShapeError extends Error {}

async function safe(p: Promise<void>): Promise<void> {
  try {
    await p;
  } catch {
    // Alerter sudah menelan galat; ini hanya sabuk pengaman.
  }
}

/**
 * Menjalankan satu job: baris `running` di jobs.job_runs (commit sendiri, jadi worker yang mati di
 * tengah meninggalkan jejak untuk closeAbandoned), panggil fungsi `jobs.*`, lalu tutup barisnya.
 * Tidak pernah melempar.
 */
export async function runJob(
  pool: Queryable,
  job: JobDef,
  alert: Alerter,
  opts: RunOptions = {},
): Promise<JobResult> {
  const log = opts.log ?? defaultLog;
  await safe(alert.start());

  // Sapu baris `running` yang ditinggal worker mati di tengah job. Saat start saja tidak cukup:
  // restart < 1 jam sesudah job terputus meninggalkan barisnya sampai restart berikutnya. Galat sapu
  // tidak menghentikan job (DB yang mati tetap tertangkap oleh insert di bawah).
  try {
    await closeAbandoned(pool, { log });
  } catch (err) {
    log('abandoned_sweep_failed', { job: job.name, code: errorCode(err) });
  }

  let runId: string;
  try {
    const { rows } = await pool.query(
      "insert into jobs.job_runs (job, status) values ($1, 'running') returning id",
      [job.name],
    );
    const parsed = IdRows.safeParse(rows);
    if (!parsed.success) throw new ShapeError();
    runId = parsed.data[0]?.id ?? '';
  } catch (err) {
    return fail(err, null);
  }

  let rows: number;
  let dq: ReturnType<typeof dqVerdict> | undefined;
  try {
    const res = await pool.query(job.sql);
    if (job.kind === 'dq') {
      const parsed = DqRows.safeParse(res.rows);
      if (!parsed.success) throw new ShapeError();
      dq = dqVerdict(parsed.data);
      rows = dq.total;
    } else {
      const parsed = CountRows.safeParse(res.rows);
      if (!parsed.success) throw new ShapeError();
      rows = parsed.data[0]?.n ?? 0;
    }
  } catch (err) {
    return fail(err, runId);
  }

  try {
    await pool.query(
      "update jobs.job_runs set status = 'ok', finished_at = now(), rows = $2 where id = $1",
      [runId, rows],
    );
  } catch (err) {
    return fail(err, null);
  }

  if (dq) {
    log(dq.status === 'ok' ? 'job_ok' : 'dq_violation', {
      job: job.name,
      status: 'ok',
      dq: dq.lines,
    });
    await safe(
      dq.status === 'ok' ? alert.ok(dq.lines.join('\n')) : alert.fail(dq.lines.join('\n')),
    );
    return { job: job.name, status: 'ok', rows, dq: dq.status };
  }
  log('job_ok', { job: job.name, status: 'ok' });
  await safe(alert.ok(`job=${job.name}`));
  return { job: job.name, status: 'ok', rows };

  async function fail(err: unknown, id: string | null): Promise<JobResult> {
    const code = errorCode(err);
    if (id !== null) {
      try {
        await pool.query(
          "update jobs.job_runs set status = 'failed', finished_at = now(), error_code = $2 where id = $1",
          [id, code],
        );
      } catch (e) {
        // Baris tetap `running`; ditutup closeAbandoned (start worker atau job berikutnya, > 1 jam).
        log('job_runs_update_failed', { job: job.name, code: errorCode(e) });
      }
    }
    log('job_failed', { job: job.name, status: 'failed', code });
    await safe(alert.fail(`job=${job.name} code=${code}`));
    return { job: job.name, status: 'failed', code, rows: null };
  }
}

/**
 * Baris `running` > 1 jam (worker mati/restart di tengah job) ditutup `failed`/`abandoned`.
 * Dipanggil saat worker start dan di awal setiap runJob. Ambang 1 jam jauh di atas umur job sah
 * (expireInSeconds 600, statement_timeout role 60 s), jadi job lain yang sedang berjalan aman.
 */
export async function closeAbandoned(pool: Queryable, opts: RunOptions = {}): Promise<number> {
  const log = opts.log ?? defaultLog;
  const { rows } = await pool.query(
    "update jobs.job_runs set status = 'failed', error_code = 'abandoned', finished_at = now()" +
      " where status = 'running' and started_at < now() - interval '1 hour' returning id",
  );
  if (rows.length > 0) log('abandoned_closed', { count: rows.length });
  return rows.length;
}
