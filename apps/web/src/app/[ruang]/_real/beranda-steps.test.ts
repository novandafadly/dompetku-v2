import { describe, expect, it } from 'vitest';
import { berandaSteps, bersamaView } from './beranda-steps';

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

describe('bersamaView (S7-B1/B2)', () => {
  const owner = { members: 1, isOwner: true, empty: false };

  it('Pribadi dan Bersama dua anggota tidak berubah dari S6', () => {
    const none = { solo: false, empty: false, invite: 'none' };
    expect(bersamaView('pribadi', null)).toEqual(none);
    expect(bersamaView('bersama', { members: 2, isOwner: true, empty: false })).toEqual(none);
    expect(bersamaView('bersama', null)).toEqual(none);
  });

  it('satu anggota: ajakan hanya untuk pemilik, dua keadaan', () => {
    expect(bersamaView('bersama', owner)).toEqual({ solo: true, empty: false, invite: 'baru' });
    expect(bersamaView('bersama', { ...owner, pendingInvite: null }).invite).toBe('baru');
    expect(
      bersamaView('bersama', {
        ...owner,
        pendingInvite: { email: 'f@example.test', expiresOn: '2026-11-07' },
      }).invite,
    ).toBe('menunggu');
    expect(bersamaView('bersama', { ...owner, isOwner: false })).toEqual({
      solo: true,
      empty: false,
      invite: 'none',
    });
  });

  it('kosong berdiri sendiri dari solo', () => {
    expect(bersamaView('bersama', { members: 2, isOwner: false, empty: true })).toEqual({
      solo: false,
      empty: true,
      invite: 'none',
    });
    expect(bersamaView('bersama', { ...owner, empty: true })).toEqual({
      solo: true,
      empty: true,
      invite: 'baru',
    });
  });
});
