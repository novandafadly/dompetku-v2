import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrototypeActionError } from './context';

/**
 * Action WhatsApp = endpoint publik: gerbang sesi lebih dulu, user selalu dari sesi (tidak ada
 * parameter user), semua kueri lewat `withUser`. SQL sebenarnya diuji di `server/wa/link.test.ts`
 * dan pgTAP 26_wa.
 */

const POOLS = { auth: {}, app: {} };
const USER_ID = '11111111-1111-4111-8111-111111111111';

const m = vi.hoisted(() => ({
  requireDataUser: vi.fn(),
  refresh: vi.fn(),
  createWaLinkCode: vi.fn(),
  unlinkWa: vi.fn(),
}));

vi.mock('@/server/auth/next', () => ({
  requireDataUser: m.requireDataUser,
  authService: () => ({ pools: POOLS }),
}));
vi.mock('next/cache', () => ({ refresh: m.refresh }));
vi.mock('@/server/wa/link', () => ({
  createWaLinkCode: m.createWaLinkCode,
  unlinkWa: m.unlinkWa,
}));

import { createLinkCode, unlinkWa } from './wa';

beforeEach(() => {
  vi.clearAllMocks();
  m.requireDataUser.mockResolvedValue({ userId: USER_ID });
});

describe('createLinkCode', () => {
  it('tanpa argumen: user dari sesi, hasil dibungkus ActionResult, tanpa refresh', async () => {
    m.createWaLinkCode.mockResolvedValue({ code: 'K7M2QX', expiresAt: '2026-11-10T01:00:00.000Z' });
    expect(createLinkCode.length).toBe(0);
    const res = await createLinkCode();
    expect(res).toEqual({
      ok: true,
      value: { code: 'K7M2QX', expiresAt: '2026-11-10T01:00:00.000Z' },
    });
    expect(m.createWaLinkCode).toHaveBeenCalledWith({ pools: POOLS, userId: USER_ID });
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('gerbang sesi dipanggil sebelum pekerjaan apa pun; redirect diteruskan', async () => {
    m.requireDataUser.mockImplementation(() => redirect('/masuk'));
    await expect(createLinkCode()).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT') as unknown,
    });
    expect(m.createWaLinkCode).not.toHaveBeenCalled();
  });

  it('mode prototipe: dilempar, bukan hasil', async () => {
    m.requireDataUser.mockResolvedValue(null);
    await expect(createLinkCode()).rejects.toBeInstanceOf(PrototypeActionError);
    expect(m.createWaLinkCode).not.toHaveBeenCalled();
  });

  it('galat tak dikenal: unknown, dan log tidak memuat kode atau pesan galat', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m.createWaLinkCode.mockRejectedValue(new Error('rahasia K7M2QX'));
    expect(await createLinkCode()).toEqual({ ok: false, error: { code: 'unknown' } });
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/K7M2QX|rahasia/);
    spy.mockRestore();
  });

  it('koneksi putus: network', async () => {
    m.createWaLinkCode.mockRejectedValue(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }));
    expect(await createLinkCode()).toEqual({ ok: false, error: { code: 'network' } });
  });
});

describe('unlinkWa', () => {
  it('tanpa argumen: user dari sesi, lalu refresh()', async () => {
    m.unlinkWa.mockResolvedValue(undefined);
    expect(unlinkWa.length).toBe(0);
    expect(await unlinkWa()).toEqual({ ok: true, value: undefined });
    expect(m.unlinkWa).toHaveBeenCalledWith({ pools: POOLS, userId: USER_ID });
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it('gerbang sesi lebih dulu; redirect diteruskan tanpa menyentuh DB', async () => {
    m.requireDataUser.mockImplementation(() => redirect('/masuk'));
    await expect(unlinkWa()).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT') as unknown,
    });
    expect(m.unlinkWa).not.toHaveBeenCalled();
  });

  it('galat: hasil galat, tanpa refresh', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m.unlinkWa.mockRejectedValue(new Error('boom'));
    expect(await unlinkWa()).toEqual({ ok: false, error: { code: 'unknown' } });
    expect(m.refresh).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
