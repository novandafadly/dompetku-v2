import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { httpJson, ProviderError, PROVIDERS, StubPriceSource } from './price-source';
import { blockedFetches } from './test-setup';

/** Server stub penyedia lokal; perilaku per path. Base https palsu dialihkan ke sini oleh fetch tes. */
const hits: string[] = [];
const server = http.createServer((req, res) => {
  const path = req.url ?? '';
  hits.push(path);
  if (path.startsWith('/ok')) {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ close: 9875 }));
  } else if (path.startsWith('/redirect')) {
    res.writeHead(302, { location: '/ok-target' });
    res.end();
  } else if (path.startsWith('/s404')) {
    res.writeHead(404);
    res.end('{}');
  } else if (path.startsWith('/s503')) {
    res.writeHead(503);
    res.end('{}');
  } else if (path.startsWith('/big-declared')) {
    res.writeHead(200, { 'content-length': String(300 * 1024) });
    res.end(Buffer.alloc(300 * 1024, 0x20));
  } else if (path.startsWith('/big-chunked')) {
    // Tanpa content-length: batas harus berlaku saat membaca aliran.
    res.writeHead(200, { 'transfer-encoding': 'chunked' });
    const chunk = Buffer.alloc(64 * 1024, 0x20);
    for (let i = 0; i < 5; i++) res.write(chunk);
    res.end();
  } else if (path.startsWith('/broken')) {
    res.end('{"close": 98');
  } else if (path.startsWith('/wrong-shape')) {
    res.end(JSON.stringify({ close: 'mahal' }));
  } else if (path.startsWith('/slow')) {
    setTimeout(() => res.end('{"close":1}'), 2000);
  } else {
    res.writeHead(500);
    res.end();
  }
});
let local = '';
const BASE = 'https://harga.test';
const href = (input: string | URL | Request) =>
  input instanceof Request ? input.url : input.toString();
const viaLocal: typeof fetch = (input, init) => fetch(href(input).replace(BASE, local), init);

beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  local = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const Shape = z.object({ close: z.number().int() });
const client = (opts: { timeoutMs?: number } = {}) =>
  httpJson({ base: BASE, fetch: viaLocal, ...opts });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ProviderError);
    // Pesan = kode saja: tanpa URL, path, atau isi respons.
    expect((e as Error).message).toBe((e as ProviderError).code);
    return (e as ProviderError).code;
  }
  return 'tanpa galat';
}

describe('httpJson (pembungkus fetch penyedia)', () => {
  it('JSON sah sesuai skema', async () => {
    await expect(client()('/ok?s=BBCA.JK', Shape)).resolves.toEqual({ close: 9875 });
  });

  it('base harus https dan path tidak bisa berpindah origin', async () => {
    expect(() => httpJson({ base: 'http://harga.test' })).toThrow('provider_base_not_https');
    const get = client();
    await expect(get('//evil.test/ok', Shape)).rejects.toThrow('provider_path_invalid');
    await expect(get('https://evil.test/ok', Shape)).rejects.toThrow('provider_path_invalid');
  });

  it('memanggil fetch dengan redirect error, timeout, GET, dan header tambahan', async () => {
    const spy = vi.fn(viaLocal);
    await httpJson({ base: BASE, fetch: spy, headers: { 'x-api-key': 'kunci' } })('/ok', Shape);
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(url && href(url)).toBe(`${BASE}/ok`);
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get('x-api-key')).toBe('kunci');
  });

  it('redirect ditolak (tidak diikuti) → provider_network', async () => {
    hits.length = 0;
    expect(await code(client()('/redirect', Shape))).toBe('provider_network');
    expect(hits).toEqual(['/redirect']);
  });

  it('4xx → provider_http_4xx, 5xx → provider_http_5xx', async () => {
    expect(await code(client()('/s404', Shape))).toBe('provider_http_4xx');
    expect(await code(client()('/s503', Shape))).toBe('provider_http_5xx');
  });

  it('badan > 256 KiB (content-length atau aliran) → provider_too_large', async () => {
    expect(await code(client()('/big-declared', Shape))).toBe('provider_too_large');
    expect(await code(client()('/big-chunked', Shape))).toBe('provider_too_large');
  });

  it('JSON rusak atau bentuk salah → provider_shape', async () => {
    expect(await code(client()('/broken', Shape))).toBe('provider_shape');
    expect(await code(client()('/wrong-shape', Shape))).toBe('provider_shape');
  });

  it('lewat batas waktu → provider_timeout', async () => {
    expect(await code(client({ timeoutMs: 100 })('/slow', Shape))).toBe('provider_timeout');
  });

  it('host tidak terjangkau → provider_network', async () => {
    const get = httpJson({
      base: BASE,
      fetch: (input, init) => fetch(href(input).replace(BASE, 'http://127.0.0.1:1'), init),
    });
    expect(await code(get('/ok', Shape))).toBe('provider_network');
  });
});

describe('tanpa jaringan keluar di tes', () => {
  it('fetch global ke host selain loopback ditolak pagar test-setup', async () => {
    const before = blockedFetches.length;
    await expect(fetch('https://query1.finance.yahoo.com/')).rejects.toThrow(
      'fetch_blocked_in_tests',
    );
    expect(blockedFetches.slice(before)).toEqual(['query1.finance.yahoo.com']);
  });

  it('belum ada adapter terdaftar (K1: harga manual; adapter = Task 8)', () => {
    expect([...PROVIDERS.keys()]).toEqual([]);
  });

  it('StubPriceSource mencatat panggilan tanpa fetch', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const src = new StubPriceSource((t) => t.map((ticker) => ({ ticker, close: 1000 })));
    await expect(src.fetchClose(['BBCA'], '2026-11-10')).resolves.toEqual([
      { ticker: 'BBCA', close: 1000 },
    ]);
    expect(src.calls).toEqual([{ tickers: ['BBCA'], on: '2026-11-10' }]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
