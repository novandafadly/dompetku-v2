import { describe, expect, it } from 'vitest';
import { berandaSteps } from './beranda-steps';

const base = { hasOperasional: false, hasExpense: false, invite: false };

describe('berandaSteps (checklist Beranda nyata)', () => {
  it('Akun aman selalu selesai; dompet dan catat mengikuti data ruang', () => {
    expect(berandaSteps({ ruang: 'pribadi', ...base })).toEqual([
      { key: 'aman', done: true },
      { key: 'dompet', done: false },
      { key: 'catat', done: false },
    ]);
    expect(
      berandaSteps({ ruang: 'bersama', ...base, hasOperasional: true, hasExpense: true }),
    ).toEqual([
      { key: 'aman', done: true },
      { key: 'dompet', done: true },
      { key: 'catat', done: true },
    ]);
  });

  it('Tambah dompet hanya selesai dengan dompet operasional aktif', () => {
    // Loader: hasOperasional = pocket operasional dan tidak terarsip (tabungan/kantor tidak cukup).
    const dompet = (hasOperasional: boolean) =>
      berandaSteps({ ruang: 'pribadi', ...base, hasOperasional }).find((s) => s.key === 'dompet');
    expect(dompet(false)).toEqual({ key: 'dompet', done: false });
    expect(dompet(true)).toEqual({ key: 'dompet', done: true });
  });

  it('Undang Farida hanya di Pribadi, bila pemilik dan Bersama belum lengkap (invite)', () => {
    expect(berandaSteps({ ruang: 'pribadi', ...base, invite: true }).at(-1)).toEqual({
      key: 'undang',
      done: false,
    });
    expect(berandaSteps({ ruang: 'pribadi', ...base }).some((s) => s.key === 'undang')).toBe(false);
    expect(
      berandaSteps({ ruang: 'bersama', ...base, invite: true }).some((s) => s.key === 'undang'),
    ).toBe(false);
  });
});
