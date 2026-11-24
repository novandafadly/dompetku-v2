import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const isPrototype = vi.hoisted(() => vi.fn(() => false));
const ruangContext = vi.hoisted(() => vi.fn<(p: unknown) => Promise<unknown>>());
const exportLaporanPdf = vi.hoisted(() => vi.fn<(...a: unknown[]) => Promise<unknown>>());
vi.mock('@/server/env', () => ({ isPrototype: () => isPrototype() }));
vi.mock('../../_real/context', () => ({ ruangContext: (p: unknown) => ruangContext(p) }));
vi.mock('@/server/ledger/ekspor', async () => {
  const { createRateLimiter } = await import('@/server/wa/ratelimit');
  return {
    exportLaporanPdf: (...a: unknown[]) => exportLaporanPdf(...a),
    exportLimiter: createRateLimiter(10, 3_600_000),
  };
});

type Route = typeof import('./route');
let route: Route;
const params = Promise.resolve({ ruang: 'pribadi' });
const req = (qs = '') => new Request(`http://localhost/pribadi/laporan/ekspor-pdf${qs}`);
let user = 0;

beforeEach(async () => {
  vi.resetModules();
  isPrototype.mockReturnValue(false);
  user += 1;
  ruangContext.mockResolvedValue({ userId: `u${String(user)}`, spaceId: 's', kind: 'personal' });
  exportLaporanPdf.mockResolvedValue({
    pdf: Uint8Array.from('%PDF-1.4\n%%EOF\n', (c) => c.charCodeAt(0)),
    filename: 'dompetku-pribadi-2026-11.pdf',
    rows: [],
    summary: { pemasukan: 0, pengeluaran: 0, selisih: 0 },
  });
  route = await import('./route');
});

describe('GET /[ruang]/laporan/ekspor-pdf', () => {
  it('200: PDF sebagai unduhan, no-store, nosniff; parameter diteruskan ke loader', async () => {
    const res = await route.GET(req('?periode=2026-10&basis=kalender'), { params });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="dompetku-pribadi-2026-11.pdf"',
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer()).toString('latin1')).toContain('%PDF-1.4');
    expect(exportLaporanPdf).toHaveBeenCalledWith(expect.anything(), {
      label: '2026-10',
      basis: 'kalender',
    });
  });

  it('parameter ganda atau kosong = nilai tak ada (periode berjalan di loader)', async () => {
    await route.GET(req('?periode=2026-10&periode=2026-09'), { params });
    expect(exportLaporanPdf).toHaveBeenLastCalledWith(expect.anything(), {
      label: undefined,
      basis: undefined,
    });
  });

  it('prototipe = 404 tanpa menyentuh gerbang atau loader', async () => {
    isPrototype.mockReturnValue(true);
    await expect(route.GET(req(), { params })).rejects.toThrow();
    expect(ruangContext).not.toHaveBeenCalled();
    expect(exportLaporanPdf).not.toHaveBeenCalled();
  });

  it('batas laju: 10 per jam per user, ke-11 = 429 tanpa menyentuh DB', async () => {
    for (let i = 0; i < 10; i++) expect((await route.GET(req(), { params })).status).toBe(200);
    const res = await route.GET(req(), { params });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('3600');
    expect(exportLaporanPdf).toHaveBeenCalledTimes(10);
  });

  it('export_too_large = 422 teks polos no-store', async () => {
    exportLaporanPdf.mockRejectedValueOnce(
      Object.assign(new Error('export_too_large'), { code: 'DK422' }),
    );
    const res = await route.GET(req(), { params });
    expect(res.status).toBe(422);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toBe('export_too_large');
  });
});
