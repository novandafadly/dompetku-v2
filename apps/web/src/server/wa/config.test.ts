import { describe, expect, it, vi } from 'vitest';
import { EnvError } from '../env';
import { readWaEnv } from './config';

vi.mock('server-only', () => ({}));

const full = {
  WA_WEBHOOK_SECRET: 'rahasia-webhook-1234',
  OPENWA_URL: 'http://127.0.0.1:2785/',
  OPENWA_API_KEY: 'kunci-api-rahasia',
  OPENWA_SESSION: '8f3c2b1a-9d4e-4c7a-8b2f-1e6d5a4c3b2a',
};

describe('readWaEnv', () => {
  it('null saat semua kosong', () => {
    expect(readWaEnv({})).toBeNull();
    expect(readWaEnv({ WA_WEBHOOK_SECRET: '  ', WA_BOT_NUMBER: '+6281' })).toBeNull();
  });
  it('lengkap dengan bawaan', () => {
    expect(readWaEnv(full)).toEqual({
      webhookSecret: full.WA_WEBHOOK_SECRET,
      openwaUrl: 'http://127.0.0.1:2785',
      apiKey: full.OPENWA_API_KEY,
      session: full.OPENWA_SESSION,
      maxAmount: 100_000_000,
      ratePerMin: 30,
      botNumber: null,
    });
  });
  it('membaca opsional', () => {
    const e = readWaEnv({
      ...full,
      WA_MAX_AMOUNT: '5000',
      WA_RATE_PER_MIN: '3',
      WA_BOT_NUMBER: '+62811',
    });
    expect(e).toMatchObject({ maxAmount: 5000, ratePerMin: 3, botNumber: '+62811' });
  });
  it.each(['WA_WEBHOOK_SECRET', 'OPENWA_URL', 'OPENWA_API_KEY', 'OPENWA_SESSION'])(
    'sebagian terisi: %s hilang = EnvError menyebut nama',
    (name) => {
      const env: Record<string, string | undefined> = { ...full, [name]: undefined };
      expect(() => readWaEnv(env)).toThrow(EnvError);
      expect(() => readWaEnv(env)).toThrow(name);
    },
  );
  it('menolak angka tidak valid tanpa membocorkan nilai rahasia', () => {
    for (const v of ['0', '-1', '1.5', 'abc', '1e3'])
      expect(() => readWaEnv({ ...full, WA_MAX_AMOUNT: v })).toThrow(/WA_MAX_AMOUNT/);
    expect(() => readWaEnv({ ...full, WA_WEBHOOK_SECRET: 'pendek' })).toThrow(/minimal 16/);
    expect(() => readWaEnv({ ...full, OPENWA_URL: 'bukan url' })).toThrow(/OPENWA_URL/);
    // Galat ditangkap lalu diperiksa di luar catch: tes gagal bila tidak ada yang dilempar.
    let err: unknown = null;
    try {
      readWaEnv({ ...full, OPENWA_URL: 'ftp://x' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EnvError);
    expect(String(err)).toMatch(/OPENWA_URL harus http/);
    expect(String(err)).not.toContain(full.OPENWA_API_KEY);
  });
});
