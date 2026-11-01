import { describe, expect, it } from 'vitest';
import { EnvError, isPrototype, readServerEnv } from './env';

const ok = {
  DATABASE_URL: 'postgres://dompetku_web@db/dompetku',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'https://dompet.novandafadly.com/',
  RESEND_API_KEY: 're_x',
  NODE_ENV: 'production',
};

describe('readServerEnv', () => {
  it('nilai bawaan dari BETTER_AUTH_URL', () => {
    const env = readServerEnv(ok);
    expect(env.baseURL).toBe('https://dompet.novandafadly.com');
    expect(env.rpID).toBe('dompet.novandafadly.com');
    expect(env.secureCookies).toBe(true);
    expect(env.checkPwnedPasswords).toBe(true);
    expect(env.emailFile).toBeNull();
  });

  it('menolak konfigurasi produksi yang tidak aman', () => {
    expect(() => readServerEnv({ ...ok, BETTER_AUTH_SECRET: 'pendek' })).toThrow(EnvError);
    expect(() => readServerEnv({ ...ok, BETTER_AUTH_URL: 'http://dompet.example' })).toThrow(
      EnvError,
    );
    expect(() => readServerEnv({ ...ok, BETTER_AUTH_URL: 'https://x.test/app' })).toThrow(EnvError);
    expect(() => readServerEnv({ ...ok, RESEND_API_KEY: '' })).toThrow('RESEND_API_KEY');
    expect(() => readServerEnv({ ...ok, DATABASE_URL: undefined })).toThrow('DATABASE_URL');
  });

  it('email ke log/berkas ditolak di produksi, boleh di localhost (tes e2e)', () => {
    expect(() => readServerEnv({ ...ok, AUTH_EMAIL_FILE: '/tmp/x' })).toThrow('AUTH_EMAIL_FILE');
    expect(() => readServerEnv({ ...ok, AUTH_EMAIL_LOG: '1' })).toThrow('AUTH_EMAIL_LOG');
    const local = { ...ok, BETTER_AUTH_URL: 'http://localhost:3300', RESEND_API_KEY: '' };
    expect(readServerEnv({ ...local, AUTH_EMAIL_FILE: '/tmp/x' }).emailFile).toBe('/tmp/x');
    expect(
      readServerEnv({ ...local, RESEND_API_KEY: 're_x', AUTH_EMAIL_FILE: '/tmp/x' }).emailFile,
    ).toBeNull();
  });
});

describe('isPrototype', () => {
  it('hanya "1"', () => {
    expect(isPrototype({ NEXT_PUBLIC_PROTOTYPE: '1' })).toBe(true);
    expect(isPrototype({ NEXT_PUBLIC_PROTOTYPE: 'true' })).toBe(false);
    expect(isPrototype({})).toBe(false);
  });
});
