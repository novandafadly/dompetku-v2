import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const isPrototype = vi.hoisted(() => vi.fn(() => false));
const ruangContext = vi.hoisted(() => vi.fn<(p: unknown) => Promise<unknown>>());
const exportLaporanCsv = vi.hoisted(() => vi.fn<(...a: unknown[]) => Promise<unknown>>());
vi.mock('@/server/env', () => ({ isPrototype: () => isPrototype() }));
vi.mock('../../_real/context', () => ({ ruangContext: (p: unknown) => ruangContext(p) }));
vi.mock('@/server/ledger/ekspor', async () => {
  const { createRateLimiter } = await import('@/server/wa/ratelimit');
  return {
    exportLaporanCsv: (...a: unknown[]) => exportLaporanCsv(...a),
    exportLimiter: createRateLimiter(10, 3_600_000),
  };
});

type Route = typeof import('./route');
let route: Route;
const params = Promise.resolve({ ruang: 'pribadi' });
const req = (qs = '') => new Request(`http://localhost/pribadi/laporan/ekspor${qs}`);
let user = 0;

beforeEach(async () => {
  vi.resetModules();
  isPrototype.mockReturnValue(false);
  user += 1;
  ruangContext.mockResolvedValue({ userId: `u${String(user)}`, spaceId: 's', kind: 'personal' });
  exportLaporanCsv.mockResolvedValue({
    csv: '﻿Tanggal\r\n',
    filename: 'dompetku-pribadi-2026-11.csv',
    rows: [],
  });
  route = await import('./route');
});

describe('GET /[ruang]/laporan/ekspor', () => {
  it('200: CSV UTF-8 sebagai unduhan, no-store, nosniff; parameter diteruskan ke loader', async () => {
    const res = await route.GET(req('?periode=2026-10&basis=kalender'), { params });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="dompetku-pribadi-2026-11.csv"',
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await res.text()).toContain('Tanggal');
    expect(exportLaporanCsv).toHaveBeenCalledWith(expect.anything(), {
      label: '2026-10',
      basis: 'kalender',
    });
  });

  it('parameter ganda atau tanpa parameter = nilai tak ada (periode berjalan di loader)', async () => {
    await route.GET(req('?periode=2026-10&periode=2026-09'), { params });
    expect(exportLaporanCsv).toHaveBeenLastCalledWith(expect.anything(), {
      label: undefined,
      basis: undefined,
    });
  });

  it('prototipe = 404 tanpa menyentuh gerbang atau loader', async () => {
    isPrototype.mockReturnValue(true);
    await expect(route.GET(req(), { params })).rejects.toThrow();
    expect(ruangContext).not.toHaveBeenCalled();
    expect(exportLaporanCsv).not.toHaveBeenCalled();
  });

  it('batas laju: 10 per jam per user, ke-11 = 429 tanpa menyentuh DB; user lain tidak terpengaruh', async () => {
    for (let i = 0; i < 10; i++) expect((await route.GET(req(), { params })).status).toBe(200);
    exportLaporanCsv.mockClear();
    const res = await route.GET(req(), { params });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('3600');
    expect(exportLaporanCsv).not.toHaveBeenCalled();
    ruangContext.mockResolvedValue({ userId: 'lain', spaceId: 's', kind: 'personal' });
    expect((await route.GET(req(), { params })).status).toBe(200);
  });

  it('export_too_large = 422 teks polos', async () => {
    exportLaporanCsv.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'DK422', message: 'export_too_large' }),
    );
    const res = await route.GET(req(), { params });
    expect(res.status).toBe(422);
    expect(await res.text()).toBe('export_too_large');
  });

  it('galat lain = 500 tanpa isi galat; dilog hanya tag', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    exportLaporanCsv.mockRejectedValue(new Error('rahasia Rp 500.000'));
    const res = await route.GET(req(), { params });
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('error');
    expect(JSON.stringify(log.mock.calls)).not.toContain('500.000');
    log.mockRestore();
  });
});
