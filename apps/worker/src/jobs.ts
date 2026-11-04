/**
 * Job terjadwal worker (AFD §5, BSD §10). Semua WIB; jendela 01:00–01:30 WIB tidak bentrok
 * dengan base backup 02:00 dan uji restore Minggu 04:00 (runbook S2). statement_timeout role
 * worker 60 s, jadi tiap job selesai jauh sebelum 02:00.
 */
export type JobName =
  'dq_reconcile' | 'purge_idempotency' | 'purge_unfinished_users' | 'purge_audit' | 'purge_voided';

export interface JobDef {
  name: JobName;
  cron: string;
  tz: 'Asia/Jakarta';
  /** Check Healthchecks: `dq` (dompetku-dq) atau `jobs` (dompetku-jobs). */
  check: 'dq' | 'jobs';
  /** `count`: fungsi mengembalikan int (baris terhapus); `dq`: tabel cek DQ. */
  kind: 'count' | 'dq';
  sql: string;
}

const TZ = 'Asia/Jakarta';

export const JOBS: readonly JobDef[] = [
  {
    name: 'dq_reconcile',
    cron: '0 1 * * *',
    tz: TZ,
    check: 'dq',
    kind: 'dq',
    sql: 'select check_id, severity, violations from jobs.dq_reconcile()',
  },
  {
    name: 'purge_idempotency',
    cron: '20 1 * * *',
    tz: TZ,
    check: 'jobs',
    kind: 'count',
    sql: 'select jobs.purge_idempotency() as n',
  },
  {
    name: 'purge_unfinished_users',
    cron: '25 1 * * *',
    tz: TZ,
    check: 'jobs',
    kind: 'count',
    sql: 'select jobs.purge_unfinished_users() as n',
  },
  {
    name: 'purge_audit',
    cron: '30 1 * * *',
    tz: TZ,
    check: 'jobs',
    kind: 'count',
    sql: 'select jobs.purge_audit() as n',
  },
  {
    // AFD §5 "mingguan": Senin.
    name: 'purge_voided',
    cron: '15 1 * * 1',
    tz: TZ,
    check: 'jobs',
    kind: 'count',
    sql: 'select jobs.purge_voided() as n',
  },
];

export function jobDef(name: JobName): JobDef {
  const job = JOBS.find((j) => j.name === name);
  if (!job) throw new Error(`job tidak dikenal: ${name}`);
  return job;
}

export interface DqRow {
  check_id: string;
  severity: 'error' | 'warn';
  violations: number;
}

/** DQ07 (saldo negatif, warn) tidak memicu alert; jumlahnya hanya dicantumkan di ping sukses. */
const INFO_ONLY = new Set(['DQ07']);

/**
 * R20: `fail` bila ada cek dengan pelanggaran > 0 (error atau warn) selain DQ07.
 * `lines` = semua cek > 0 dalam urutan keluaran dq_run.
 */
export function dqVerdict(rows: readonly DqRow[]): {
  status: 'ok' | 'fail';
  lines: string[];
  total: number;
} {
  const hits = rows.filter((r) => r.violations > 0);
  return {
    status: hits.some((r) => !INFO_ONLY.has(r.check_id)) ? 'fail' : 'ok',
    lines: hits.map((r) => `${r.check_id} ${r.severity} ${String(r.violations)}`),
    total: rows.reduce((s, r) => s + r.violations, 0),
  };
}
