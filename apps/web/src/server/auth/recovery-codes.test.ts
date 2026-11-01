import { describe, expect, it } from 'vitest';
import {
  DUMMY_RECOVERY_HASH,
  RECOVERY_CODE_COUNT,
  padRecoveryHashes,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyRecoveryCode,
} from './recovery-codes';

describe('kode pemulihan', () => {
  it('10 kode unik berbentuk XXXXX-XXXXX (Crockford)', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  });

  it('normalisasi: huruf kecil, spasi, strip, O/I/L', () => {
    expect(normalizeRecoveryCode('abcde-fghjk')).toBe('ABCDEFGHJK');
    expect(normalizeRecoveryCode(' o1il2 34567 ')).toBe('01112' + '34567');
    expect(normalizeRecoveryCode('ABCD')).toBeNull();
    expect(normalizeRecoveryCode('ABCDE-FGHJU')).toBeNull();
  });

  it('hash argon2id PHC (lulus CHECK DB) dan verifikasi', async () => {
    const [code = ''] = generateRecoveryCodes(1);
    const hash = await hashRecoveryCode(code);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=4096,t=3,p=1\$/);
    expect(hash.length).toBeLessThanOrEqual(200);
    expect(await verifyRecoveryCode(code.toLowerCase().replace('-', ' '), hash)).toBe(true);
    expect(await verifyRecoveryCode('00000-00000', hash)).toBe(false);
    expect(await hashRecoveryCode(code)).not.toBe(hash);
  });

  it('hash pengganti tidak pernah cocok', async () => {
    expect(await verifyRecoveryCode('00000-00000', DUMMY_RECOVERY_HASH)).toBe(false);
  });

  it('selalu tepat 10 hash untuk diverifikasi', () => {
    expect(padRecoveryHashes([])).toHaveLength(RECOVERY_CODE_COUNT);
    expect(padRecoveryHashes(['a', 'b'])).toEqual([
      'a',
      'b',
      ...Array<string>(8).fill(DUMMY_RECOVERY_HASH),
    ]);
    expect(padRecoveryHashes(Array<string>(12).fill('x'))).toHaveLength(RECOVERY_CODE_COUNT);
  });
});
