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

  it('berkas email tidak pernah dipakai bila Resend aktif', () => {
    expect(readServerEnv({ ...ok, AUTH_EMAIL_FILE: '/tmp/x' }).emailFile).toBeNull();
    expect(readServerEnv({ ...ok, RESEND_API_KEY: '', AUTH_EMAIL_FILE: '/tmp/x' }).emailFile).toBe(
      '/tmp/x',
    );
  });
});

describe('isPrototype', () => {
  it('hanya "1"', () => {
    expect(isPrototype({ NEXT_PUBLIC_PROTOTYPE: '1' })).toBe(true);
    expect(isPrototype({ NEXT_PUBLIC_PROTOTYPE: 'true' })).toBe(false);
    expect(isPrototype({})).toBe(false);
  });
});
