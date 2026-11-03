import { describe, expect, it, vi } from 'vitest';
import { healthchecks } from './alert';
import type { LogFn } from './log';

function fakeFetch(status = 200) {
  const calls: { url: string; method: string; body: string }[] = [];
  const fn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: url instanceof Request ? url.url : url.toString(),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
    });
    return Promise.resolve(new Response('', { status }));
  });
  return { fn, calls };
}

describe('healthchecks', () => {
  it('start/ok/fail mem-POST ke URL ping, /start, dan /fail dengan body apa adanya', async () => {
    const { fn, calls } = fakeFetch();
    const a = healthchecks('https://hc.example/abc', { fetch: fn, log: () => undefined });
    await a.start();
    await a.ok('DQ07 warn 1');
    await a.fail('job=purge_audit code=57014');
    expect(calls).toEqual([
      { url: 'https://hc.example/abc/start', method: 'POST', body: '' },
      { url: 'https://hc.example/abc', method: 'POST', body: 'DQ07 warn 1' },
      { url: 'https://hc.example/abc/fail', method: 'POST', body: 'job=purge_audit code=57014' },
    ]);
  });

  it('URL kosong → tidak ada request, log alert_skipped', async () => {
    const { fn } = fakeFetch();
    const logs: unknown[] = [];
    const log: LogFn = (event, fields) => logs.push({ event, ...fields });
    const a = healthchecks(undefined, { fetch: fn, log, check: 'dq' });
    await a.start();
    await a.fail('DQ01 error 1');
    expect(fn).not.toHaveBeenCalled();
    expect(logs).toEqual([
      { event: 'alert_skipped', check: 'dq', ping: 'start' },
      { event: 'alert_skipped', check: 'dq', ping: 'fail' },
    ]);
  });

  it('jaringan gagal tidak melempar; dicoba ulang lalu log alert_failed tanpa pesan galat', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('getaddrinfo ENOTFOUND hc.example 123456')));
    const logs: string[] = [];
    const a = healthchecks('https://hc.example/abc', {
      fetch: fn,
      log: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
      check: 'jobs',
      retryDelayMs: 0,
    });
    await expect(a.fail('job=purge_audit code=unknown')).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(3);
    expect(logs).toEqual([JSON.stringify({ event: 'alert_failed', check: 'jobs', ping: 'fail' })]);
  });

  it('status HTTP bukan 2xx dianggap gagal', async () => {
    const { fn } = fakeFetch(500);
    const logs: string[] = [];
    const a = healthchecks('https://hc.example/abc', {
      fetch: fn,
      log: (event) => logs.push(event),
      retryDelayMs: 0,
    });
    await a.ok('');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(logs).toEqual(['alert_failed']);
  });
});
