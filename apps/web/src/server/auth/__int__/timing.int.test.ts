import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Mailer } from '../mailer';
import { Browser, OWNER, PASSWORD, bootstrapOwner, createHarness, reset } from './harness';

/**
 * Respons tidak boleh menunggu penyedia email (Resend): kalau menunggu, waktu respons
 * membedakan email terdaftar dan owner_email. Mailer lambat 1,5 detik; semua respons harus jauh
 * di bawah itu dan saling berdekatan.
 */
const SLOW_MS = 1500;
const slow: Mailer = {
  send: () => new Promise((resolve) => setTimeout(resolve, SLOW_MS)),
};
const h = createHarness(slow);
afterAll(async () => {
  await new Promise((r) => setTimeout(r, SLOW_MS));
  await h.close();
});
beforeEach(() => reset(h));

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const t = performance.now();
  await fn();
  return performance.now() - t;
}

describe('waktu respons seragam', () => {
  it('lupa kata sandi: email terdaftar dan tidak, tanpa menunggu email', async () => {
    await bootstrapOwner(h);
    const known = await timed(() =>
      h.service.requestPasswordReset(new Browser('192.0.2.1').headers(), OWNER),
    );
    const unknown = await timed(() =>
      h.service.requestPasswordReset(new Browser('192.0.2.2').headers(), 'siapa@example.test'),
    );
    expect(h.mailer.sent.at(-1)?.subject).toMatch(/Atur ulang/);
    expect(known).toBeLessThan(SLOW_MS / 2);
    expect(unknown).toBeLessThan(SLOW_MS / 2);
  });

  it('akun pertama: owner_email dan email lain sama-sama menghitung hash, tanpa menunggu email', async () => {
    const other = await timed(() =>
      h.service.signUpOwner(
        new Browser('192.0.2.3').headers(),
        'X',
        'orang@example.test',
        PASSWORD,
      ),
    );
    const owner = await timed(() =>
      h.service.signUpOwner(new Browser('192.0.2.4').headers(), 'N', OWNER, PASSWORD),
    );
    expect(h.mailer.sent.at(-1)?.subject).toMatch(/Konfirmasi email/);
    expect(owner).toBeLessThan(SLOW_MS / 2);
    // Jalur email lain tetap menjalankan hash kata sandi (scrypt), bukan langsung kembali.
    const hashOnly = await timed(async () =>
      (await h.service.auth.$context).password.hash(PASSWORD),
    );
    expect(other).toBeGreaterThan(hashOnly * 0.5);
  });

  it('kode pemulihan: email terdaftar dan tidak menjalankan jumlah verifikasi yang sama', async () => {
    await bootstrapOwner(h);
    const runs = async (email: string, ip: string) =>
      timed(() => h.service.recoverySignIn(new Browser(ip).headers(), email, 'AAAAA-AAAAA'));
    const known = await runs(OWNER, '192.0.2.10');
    const unknown = await runs('siapa@example.test', '192.0.2.11');
    // 10 verifikasi argon2 di kedua jalur: selisih jauh di bawah satu jalur penuh.
    expect(Math.abs(known - unknown)).toBeLessThan(Math.max(known, unknown) * 0.5);
    expect(unknown).toBeGreaterThan(200);
  });
});
