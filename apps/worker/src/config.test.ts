import { describe, expect, it } from 'vitest';
import { checkConfig, loadConfig } from './config';

const DB = 'postgres://dompetku_worker:rahasia-sekali@db:5432/dompetku?sslmode=verify-full';

describe('loadConfig', () => {
  it('membaca DATABASE_URL dan URL Healthchecks', () => {
    const cfg = loadConfig({
      DATABASE_URL: DB,
      HC_DQ_URL: 'https://hc-ping.com/aaa',
      HC_JOBS_URL: 'https://hc-ping.com/bbb',
    });
    expect(cfg).toEqual({
      databaseUrl: DB,
      hc: { dq: 'https://hc-ping.com/aaa', jobs: 'https://hc-ping.com/bbb' },
    });
  });

  it('URL Healthchecks kosong atau tidak ada = alert dilewati (kunci tidak ada)', () => {
    const cfg = loadConfig({ DATABASE_URL: DB, HC_DQ_URL: '', HC_JOBS_URL: '  ' });
    expect(cfg.hc).toEqual({});
    expect('dq' in cfg.hc).toBe(false);
  });

  it('menolak DATABASE_URL yang bukan postgres', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x@y/z' })).toThrow();
    expect(() => loadConfig({})).toThrow();
  });

  it('menolak URL Healthchecks yang bukan https (termasuk http:)', () => {
    expect(() => loadConfig({ DATABASE_URL: DB, HC_DQ_URL: 'ftp://hc/x' })).toThrow();
    expect(() => loadConfig({ DATABASE_URL: DB, HC_DQ_URL: 'http://hc-ping.com/aaa' })).toThrow();
    expect(() => loadConfig({ DATABASE_URL: DB, HC_JOBS_URL: 'HTTP://hc-ping.com/bbb' })).toThrow();
    expect(checkConfig({ DATABASE_URL: DB, HC_JOBS_URL: 'http://hc-ping.com/bbb' })).toEqual({
      ok: false,
      fields: ['HC_JOBS_URL'],
    });
    expect(loadConfig({ DATABASE_URL: DB, HC_DQ_URL: 'HTTPS://hc-ping.com/aaa' }).hc.dq).toBe(
      'HTTPS://hc-ping.com/aaa',
    );
  });

  it('galat hanya menyebut nama variabel, tidak pernah nilainya', () => {
    let msg = '';
    try {
      loadConfig({
        DATABASE_URL: 'mysql://u:rahasia-sekali@h/d',
        HC_JOBS_URL: 'bukan url rahasia',
      });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('DATABASE_URL');
    expect(msg).toContain('HC_JOBS_URL');
    expect(msg).not.toContain('rahasia');
  });
});

describe('checkConfig', () => {
  it('valid → ok tanpa field', () => {
    expect(checkConfig({ DATABASE_URL: DB })).toEqual({ ok: true, fields: [] });
  });
  it('tidak valid → daftar nama variabel', () => {
    expect(checkConfig({ HC_DQ_URL: 'x' })).toEqual({
      ok: false,
      fields: ['DATABASE_URL', 'HC_DQ_URL'],
    });
  });
});
