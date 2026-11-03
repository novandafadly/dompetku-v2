import { PgBoss } from 'pg-boss';
import { describe, expect, it } from 'vitest';
import { dqVerdict, JOBS } from './jobs';

// previewSchedule memakai parser cron pg-boss sendiri (tanpa koneksi DB).
const boss = new PgBoss({
  connectionString: 'postgres://x@127.0.0.1:1/x',
  schema: 'pgboss',
  createSchema: false,
});
const next = (cron: string, from: string, count = 1) =>
  boss
    .previewSchedule(cron, { tz: 'Asia/Jakarta', from: new Date(from), count })
    .map((d) => d.toISOString());

describe('JOBS', () => {
  it('jadwal tetap, semua WIB', () => {
    expect(JOBS.map((j) => [j.name, j.cron, j.tz, j.check])).toEqual([
      ['dq_reconcile', '0 1 * * *', 'Asia/Jakarta', 'dq'],
      ['purge_idempotency', '20 1 * * *', 'Asia/Jakarta', 'jobs'],
      ['purge_unfinished_users', '25 1 * * *', 'Asia/Jakarta', 'jobs'],
      ['purge_audit', '30 1 * * *', 'Asia/Jakarta', 'jobs'],
      ['purge_voided', '15 1 * * 1', 'Asia/Jakarta', 'jobs'],
    ]);
  });

  it('nama job cocok dengan CHECK jobs.job_runs.job', () => {
    for (const j of JOBS) expect(j.name).toMatch(/^[a-z_]{1,40}$/);
  });

  it('cron 0 1 * * * WIB: dari 17:59Z berikutnya 18:00Z hari yang sama (01:00 WIB)', () => {
    expect(next('0 1 * * *', '2026-11-03T17:59:00Z')).toEqual(['2026-11-03T18:00:00.000Z']);
  });

  it('purge_voided hanya Senin 01:15 WIB', () => {
    // 2026-11-03 Selasa WIB; Senin berikutnya 2026-11-09 01:15 WIB = 2026-11-08T18:15Z.
    expect(next('15 1 * * 1', '2026-11-03T17:59:00Z', 2)).toEqual([
      '2026-11-08T18:15:00.000Z',
      '2026-11-15T18:15:00.000Z',
    ]);
  });

  it('tidak bentrok dengan backup 02:00 WIB dan uji restore Minggu 04:00 WIB', () => {
    for (const j of JOBS) {
      for (const at of next(j.cron, '2026-11-01T00:00:00Z', 14)) {
        // Jam WIB = UTC + 7; semua job selesai sebelum 02:00 (statement_timeout 60 s).
        const wib = (new Date(at).getUTCHours() + 7) % 24;
        expect(wib, `${j.name} ${at}`).toBe(1);
      }
    }
  });
});

describe('dqVerdict (R20)', () => {
  const nol = [
    { check_id: 'DQ01', severity: 'error', violations: 0 },
    { check_id: 'DQ04b', severity: 'error', violations: 0 },
    { check_id: 'DQ07', severity: 'warn', violations: 0 },
    { check_id: 'DQ10', severity: 'warn', violations: 0 },
  ] as const;

  it('semua 0 → ok tanpa baris', () => {
    expect(dqVerdict([...nol])).toEqual({ status: 'ok', lines: [], total: 0 });
  });

  it('warn > 0 (selain DQ07) → fail', () => {
    const rows = nol.map((r) => (r.check_id === 'DQ10' ? { ...r, violations: 2 } : r));
    expect(dqVerdict(rows)).toEqual({ status: 'fail', lines: ['DQ10 warn 2'], total: 2 });
  });

  it('error > 0 → fail, semua baris > 0 dicantumkan', () => {
    const rows = nol.map((r) =>
      r.check_id === 'DQ04b'
        ? { ...r, violations: 1 }
        : r.check_id === 'DQ07'
          ? { ...r, violations: 3 }
          : r,
    );
    expect(dqVerdict(rows)).toEqual({
      status: 'fail',
      lines: ['DQ04b error 1', 'DQ07 warn 3'],
      total: 4,
    });
  });

  it('hanya DQ07 > 0 → ok, DQ07 dicantumkan di body', () => {
    const rows = nol.map((r) => (r.check_id === 'DQ07' ? { ...r, violations: 5 } : r));
    expect(dqVerdict(rows)).toEqual({ status: 'ok', lines: ['DQ07 warn 5'], total: 5 });
  });
});
