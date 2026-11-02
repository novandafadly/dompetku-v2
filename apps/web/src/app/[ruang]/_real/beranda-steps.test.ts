import { describe, expect, it } from 'vitest';
import { berandaSteps } from './beranda-steps';

const base = { hasAccount: false, hasExpense: false, invite: false };

describe('berandaSteps (checklist Beranda nyata)', () => {
  it('Akun aman selalu selesai; dompet dan catat mengikuti data ruang', () => {
    expect(berandaSteps({ ruang: 'pribadi', ...base })).toEqual([
      { key: 'aman', done: true },
      { key: 'dompet', done: false },
      { key: 'catat', done: false },
    ]);
    expect(berandaSteps({ ruang: 'bersama', ...base, hasAccount: true, hasExpense: true })).toEqual(
      [
        { key: 'aman', done: true },
        { key: 'dompet', done: true },
        { key: 'catat', done: true },
      ],
    );
  });

  it('Undang Farida hanya bila pemilik dan Bersama belum lengkap (invite), di kedua ruang', () => {
    for (const ruang of ['pribadi', 'bersama'] as const) {
      expect(berandaSteps({ ruang, ...base, invite: true }).at(-1)).toEqual({
        key: 'undang',
        done: false,
      });
      expect(berandaSteps({ ruang, ...base }).some((s) => s.key === 'undang')).toBe(false);
    }
  });
});
