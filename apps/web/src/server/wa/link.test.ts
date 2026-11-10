import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pools } from '../db';

const m = vi.hoisted(() => ({
  withUser: vi.fn(),
  readWaEnv: vi.fn(),
  query: vi.fn(),
}));

vi.mock('../db', () => ({ withUser: m.withUser }));
vi.mock('./config', () => ({ readWaEnv: m.readWaEnv }));

import {
  createWaLinkCode,
  loadWaLink,
  maskPhone,
  unlinkWa,
  WaDisabledError,
  type WaCtx,
} from './link';

const POOLS = { auth: {}, app: { tag: 'app' } } as unknown as Pools;
const USER = '11111111-1111-4111-8111-111111111111';
const ctx: WaCtx = { pools: POOLS, userId: USER };
const ENV = { botNumber: '+62 811 0000 111' };
const BOT = '628110000111';

beforeEach(() => {
  vi.clearAllMocks();
  m.readWaEnv.mockReturnValue(ENV);
  m.withUser.mockImplementation((_pool: unknown, _uid: string, fn: (c: unknown) => unknown) =>
    fn({ query: m.query }),
  );
});

describe('maskPhone', () => {
  it('Indonesia: +62 812••••89', () => {
    expect(maskPhone('+6281234567889')).toBe('+62 812••••89');
    expect(maskPhone('+628111222333')).toBe('+62 811••••33');
  });
  it('kode negara lain: dua digit awal dan dua akhir', () => {
    expect(maskPhone('+14155550123')).toBe('+14 ••••23');
  });
  it('bukan E.164: tidak menampilkan apa pun dari nilainya', () => {
    expect(maskPhone('081234567889')).toBe('••••');
    expect(maskPhone('')).toBe('••••');
  });
  it('tidak pernah memuat sembilan digit tengah nomor', () => {
    const masked = maskPhone('+6281234567889');
    expect(masked).not.toContain('34567');
    expect(masked).not.toContain('6281234567889');
  });
});

describe('loadWaLink', () => {
  it('fitur mati (readWaEnv null): off, tanpa menyentuh DB', async () => {
    m.readWaEnv.mockReturnValue(null);
    expect(await loadWaLink(ctx)).toEqual({ state: 'off' });
    expect(m.withUser).not.toHaveBeenCalled();
  });

  it('konfigurasi setengah jadi (EnvError): dianggap mati, tidak melempar', async () => {
    m.readWaEnv.mockImplementation(() => {
      throw new Error('Variabel lingkungan X wajib diisi');
    });
    expect(await loadWaLink(ctx)).toEqual({ state: 'off' });
  });

  it('belum terhubung: unlinked + nomor bot', async () => {
    m.query.mockResolvedValue({ rows: [] });
    expect(await loadWaLink(ctx)).toEqual({ state: 'unlinked', botNumber: BOT });
  });

  it('nomor bot kosong atau tak sah, belum terhubung: nobot (tanpa Hubungkan)', async () => {
    m.query.mockResolvedValue({ rows: [] });
    m.readWaEnv.mockReturnValue({ botNumber: null });
    expect(await loadWaLink(ctx)).toEqual({ state: 'nobot' });
    m.readWaEnv.mockReturnValue({ botNumber: 'abc' });
    expect(await loadWaLink(ctx)).toEqual({ state: 'nobot' });
  });

  it('nomor bot kosong tapi sudah terhubung: tetap linked agar bisa diputus', async () => {
    m.query.mockResolvedValue({ rows: [{ phone_e164: '+6281234567889' }] });
    m.readWaEnv.mockReturnValue({ botNumber: null });
    expect(await loadWaLink(ctx)).toEqual({
      state: 'linked',
      masked: '+62 812••••89',
      botNumber: null,
    });
  });

  it('terhubung: hanya versi tersamar yang keluar, lewat withUser pool app', async () => {
    m.query.mockResolvedValue({ rows: [{ phone_e164: '+6281234567889' }] });
    const res = await loadWaLink(ctx);
    expect(res).toEqual({ state: 'linked', masked: '+62 812••••89', botNumber: BOT });
    expect(JSON.stringify(res)).not.toContain('6281234567889');
    expect(m.withUser).toHaveBeenCalledWith(POOLS.app, USER, expect.any(Function));
    // Kueri tanpa filter user: RLS baris sendiri yang membatasi, bukan parameter dari luar.
    expect(m.query.mock.calls[0]?.[0]).toMatch(/from app\.wa_links/);
    expect(m.query.mock.calls[0]).toHaveLength(1);
  });
});

describe('createWaLinkCode', () => {
  it('memanggil api.wa_create_link_code lewat withUser dan memvalidasi hasil', async () => {
    m.query.mockResolvedValue({
      rows: [{ r: { code: 'K7M2QX', expires_at: '2026-11-10T01:00:00+00:00' } }],
    });
    expect(await createWaLinkCode(ctx)).toEqual({
      code: 'K7M2QX',
      expiresAt: '2026-11-10T01:00:00.000Z',
    });
    expect(m.withUser).toHaveBeenCalledWith(POOLS.app, USER, expect.any(Function));
    expect(m.query).toHaveBeenCalledWith('select api.wa_create_link_code() as r');
  });

  it('fitur mati: WaDisabledError, DB tidak disentuh', async () => {
    m.readWaEnv.mockReturnValue(null);
    await expect(createWaLinkCode(ctx)).rejects.toBeInstanceOf(WaDisabledError);
    expect(m.withUser).not.toHaveBeenCalled();
  });

  it('nomor bot belum diatur: ditolak seperti mati', async () => {
    m.readWaEnv.mockReturnValue({ botNumber: null });
    await expect(createWaLinkCode(ctx)).rejects.toBeInstanceOf(WaDisabledError);
    expect(m.withUser).not.toHaveBeenCalled();
  });

  it('hasil DB tak dikenali ditolak (Zod), bukan ditampilkan', async () => {
    m.query.mockResolvedValue({ rows: [{ r: { code: 'abc', expires_at: 'x' } }] });
    await expect(createWaLinkCode(ctx)).rejects.toThrow();
  });
});

describe('unlinkWa', () => {
  it('memanggil api.wa_unlink lewat withUser tanpa parameter', async () => {
    m.query.mockResolvedValue({ rows: [] });
    await unlinkWa(ctx);
    expect(m.withUser).toHaveBeenCalledWith(POOLS.app, USER, expect.any(Function));
    expect(m.query).toHaveBeenCalledWith('select api.wa_unlink()');
  });
});
