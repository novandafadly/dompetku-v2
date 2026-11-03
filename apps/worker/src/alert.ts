import type { LogFields, LogFn } from './log';
import { log as defaultLog } from './log';

/**
 * Ping Healthchecks.io. Body hanya baris `DQxx severity n` atau `job=<nama> code=<kode>`
 * (dibentuk run-job.ts). Ping tidak pernah melempar: alert gagal tidak boleh menggagalkan job.
 */
export interface Alerter {
  start(): Promise<void>;
  ok(body: string): Promise<void>;
  fail(body: string): Promise<void>;
}

export interface HealthchecksOptions {
  fetch?: typeof fetch;
  log?: LogFn;
  check?: 'dq' | 'jobs';
  /** Jeda antar percobaan (total 3 percobaan). */
  retryDelayMs?: number;
  timeoutMs?: number;
}

const ATTEMPTS = 3;

export function healthchecks(url: string | undefined, opts: HealthchecksOptions = {}): Alerter {
  const doFetch = opts.fetch ?? fetch;
  const log = opts.log ?? defaultLog;
  const retryDelayMs = opts.retryDelayMs ?? 1000;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const fields = (ping: 'start' | 'ok' | 'fail'): LogFields =>
    opts.check ? { check: opts.check, ping } : { ping };

  async function ping(kind: 'start' | 'ok' | 'fail', body: string): Promise<void> {
    if (!url) {
      log('alert_skipped', fields(kind));
      return;
    }
    const target = kind === 'ok' ? url : `${url}/${kind}`;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const res = await doFetch(target, {
          method: 'POST',
          body,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) return;
      } catch {
        // Pesan galat jaringan bisa memuat URL ping (rahasia); tidak dicatat.
      }
      if (attempt < ATTEMPTS && retryDelayMs > 0) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
    log('alert_failed', fields(kind));
  }

  return {
    start: () => ping('start', ''),
    ok: (body) => ping('ok', body),
    fail: (body) => ping('fail', body),
  };
}
