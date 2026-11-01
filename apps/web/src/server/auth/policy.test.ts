import { describe, expect, it } from 'vitest';
import { SESSION_ABSOLUTE_MS, amrForPath, sessionAccess, type SessionFacts } from './policy';

const now = new Date('2026-11-01T00:00:00Z');
const base: SessionFacts = {
  amr: 'password',
  createdAt: now,
  now,
  hasStrongFactor: false,
  factorFromThisSession: false,
  provisioned: false,
};

describe('amrForPath', () => {
  it('memetakan jalur pembuat sesi', () => {
    expect(amrForPath('/passkey/verify-authentication')).toBe('passkey');
    expect(amrForPath('/two-factor/verify-totp')).toBe('password+totp');
    expect(amrForPath('/sign-in/email')).toBe('password');
    expect(amrForPath('/sign-up/email')).toBe('password');
    expect(amrForPath(undefined)).toBe('password');
  });
});

describe('sessionAccess', () => {
  it('faktor kuat + diprovisikan = penuh; belum diprovisikan = mengamankan', () => {
    for (const amr of ['passkey', 'password+totp']) {
      expect(sessionAccess({ ...base, amr, hasStrongFactor: true, provisioned: true })).toEqual({
        kind: 'full',
      });
      expect(sessionAccess({ ...base, amr, hasStrongFactor: true })).toEqual({ kind: 'securing' });
    }
  });

  it('kata sandi saja: hanya mengamankan, tidak pernah penuh', () => {
    expect(sessionAccess({ ...base, provisioned: true })).toEqual({ kind: 'securing' });
  });

  it('kata sandi saja pada akun yang sudah punya faktor kuat: ditolak', () => {
    expect(sessionAccess({ ...base, hasStrongFactor: true, provisioned: true })).toEqual({
      kind: 'denied',
      reason: 'needs_strong_factor',
    });
  });

  it('kecuali faktor itu didaftarkan sesi ini sendiri', () => {
    expect(sessionAccess({ ...base, hasStrongFactor: true, factorFromThisSession: true })).toEqual({
      kind: 'securing',
    });
  });

  it('kode pemulihan: hanya mengamankan', () => {
    expect(
      sessionAccess({ ...base, amr: 'recovery', hasStrongFactor: true, provisioned: true }),
    ).toEqual({ kind: 'securing' });
  });

  it('amr kosong atau asing: ditolak', () => {
    expect(sessionAccess({ ...base, amr: null })).toEqual({ kind: 'denied', reason: 'no_amr' });
    expect(sessionAccess({ ...base, amr: 'magic' })).toEqual({ kind: 'denied', reason: 'no_amr' });
  });

  it('lebih dari 30 hari sejak dibuat: ditolak walau faktor kuat', () => {
    const createdAt = new Date(now.getTime() - SESSION_ABSOLUTE_MS - 1000);
    expect(
      sessionAccess({
        ...base,
        amr: 'passkey',
        createdAt,
        hasStrongFactor: true,
        provisioned: true,
      }),
    ).toEqual({ kind: 'denied', reason: 'expired' });
  });
});
