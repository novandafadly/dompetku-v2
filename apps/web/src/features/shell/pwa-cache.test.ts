import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearClientCaches, USER_CACHE_PREFIX } from './pwa-cache';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('clearClientCaches (S18)', () => {
  it('menghapus hanya cache halaman pengguna (dompetku-pages-*), membiarkan cache aset statis, dan mengosongkan sessionStorage', async () => {
    const deleted: string[] = [];
    const mockCaches = {
      keys: vi
        .fn()
        .mockResolvedValue([
          `${USER_CACHE_PREFIX}v1`,
          `${USER_CACHE_PREFIX}v2`,
          'dompetku-static-v1',
        ]),
      delete: vi.fn().mockImplementation((k: string) => {
        deleted.push(k);
        return Promise.resolve(true);
      }),
    };
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: mockCaches,
    });

    const postMessage = vi.fn().mockImplementation((_msg: unknown, ports?: MessagePort[]) => {
      ports?.[0]?.postMessage({ ok: true });
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: { postMessage },
      },
    });

    window.sessionStorage.setItem('k', 'v');
    await clearClientCaches();

    expect(deleted).toEqual([`${USER_CACHE_PREFIX}v1`, `${USER_CACHE_PREFIX}v2`]);
    expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_USER_CACHES' }, expect.any(Array));
    expect(window.sessionStorage.length).toBe(0);
  });
});
