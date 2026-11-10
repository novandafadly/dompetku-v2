import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WaEnv } from '@/server/wa/config';

vi.mock('server-only', () => ({}));

const noop = (): void => undefined;
const SECRET = 'rahasia-webhook-1234';
const env: WaEnv = {
  webhookSecret: SECRET,
  openwaUrl: 'http://127.0.0.1:2785',
  apiKey: 'kunci-api-rahasia',
  session: '8f3c2b1a-9d4e-4c7a-8b2f-1e6d5a4c3b2a',
  maxAmount: 100_000_000,
  ratePerMin: 30,
  botNumber: null,
};

const readWaEnv = vi.fn<() => WaEnv | null>();
const handleInbound = vi.fn<(deps: unknown, msg: unknown) => Promise<void>>();
const createPools = vi.fn(() => ({ auth: {}, app: {} }));

vi.mock('@/server/wa/config', () => ({ readWaEnv: () => readWaEnv() }));
vi.mock('@/server/db', () => ({ createPools: () => createPools() }));
vi.mock('@/server/env', () => ({ readServerEnv: () => ({ databaseUrl: 'postgres://x/y' }) }));
vi.mock('@/server/wa/handle', async (orig) => {
  const real = await orig<typeof import('@/server/wa/handle')>();
  return { ...real, handleInbound: (d: unknown, m: unknown) => handleInbound(d, m) };
});

const fx = (n: string) =>
  readFileSync(join(process.cwd(), 'src/server/wa/__fixtures__', `${n}.json`));
const sig = (body: Uint8Array | string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const parseFx = (): { data: Record<string, unknown> } =>
  JSON.parse(fx('message-private').toString('utf8')) as { data: Record<string, unknown> };

const call = (i: number): [unknown, unknown] => {
  const c = handleInbound.mock.calls[i];
  if (!c) throw new Error('handleInbound belum dipanggil');
  return c;
};

type Route = typeof import('./route');
let route: Route;

function post(body: Uint8Array | string, headers: Record<string, string> = {}, signed = true) {
  const h = new Headers(headers);
  if (signed && !h.has('x-openwa-signature')) h.set('x-openwa-signature', sig(body));
  return route.POST(
    new Request('http://localhost/api/wa/webhook', {
      method: 'POST',
      body: body as BodyInit,
      headers: h,
    }),
  );
}

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  readWaEnv.mockReset().mockReturnValue(env);
  handleInbound.mockReset().mockResolvedValue(undefined);
  createPools.mockClear();
  route = await import('./route');
});

describe('POST /api/wa/webhook', () => {
  it('fitur mati = 404 tanpa membuat pool', async () => {
    readWaEnv.mockReturnValue(null);
    const res = await post(fx('message-private'));
    expect(res.status).toBe(404);
    expect(createPools).not.toHaveBeenCalled();
    expect(handleInbound).not.toHaveBeenCalled();
  });

  it('konfigurasi rusak = 503 generik', async () => {
    readWaEnv.mockImplementation(() => {
      throw new Error('rahasia bocor?');
    });
    vi.spyOn(console, 'warn').mockImplementation(noop);
    const res = await post(fx('message-private'));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('rahasia');
  });

  it('tanda tangan hilang, salah, atau rahasia lain = 401', async () => {
    const body = fx('message-private');
    expect((await post(body, {}, false)).status).toBe(401);
    expect((await post(body, { 'x-openwa-signature': 'sha256=abc' })).status).toBe(401);
    expect(
      (await post(body, { 'x-openwa-signature': sig(body, 'rahasia-lain-12345678') })).status,
    ).toBe(401);
    expect(handleInbound).not.toHaveBeenCalled();
  });

  it('body diubah satu byte = 401', async () => {
    const body = new Uint8Array(fx('message-private'));
    const signature = sig(body);
    body[body.length - 3] = (body[body.length - 3] ?? 0) ^ 1;
    expect((await post(body, { 'x-openwa-signature': signature })).status).toBe(401);
    expect(handleInbound).not.toHaveBeenCalled();
  });

  it('401 tidak mem-parse body dan tidak mencatat apa pun', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
    const log = vi.spyOn(console, 'log').mockImplementation(noop);
    const parse = vi.spyOn(JSON, 'parse');
    await post('{bukan json', { 'x-openwa-signature': 'sha256=00' });
    expect(parse.mock.calls.some(([t]) => t.includes('bukan json'))).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('event non-pesan = 200 tanpa efek', async () => {
    const res = await post(fx('session-status'));
    expect(res.status).toBe(200);
    expect(handleInbound).not.toHaveBeenCalled();
  });

  it('JSON rusak bertanda tangan sah = 200 tanpa efek', async () => {
    const res = await post('{rusak');
    expect(res.status).toBe(200);
    expect(handleInbound).not.toHaveBeenCalled();
  });

  it.each(['message-group', 'message-fromme', 'message-image'])(
    '%s = 200 tanpa handleInbound',
    async (n) => {
      const res = await post(fx(n));
      expect(res.status).toBe(200);
      expect(handleInbound).not.toHaveBeenCalled();
    },
  );

  it('status@broadcast = 200 tanpa handleInbound', async () => {
    const j = parseFx();
    j.data.from = 'status@broadcast';
    j.data.chatId = 'status@broadcast';
    const res = await post(JSON.stringify(j));
    expect(res.status).toBe(200);
    expect(handleInbound).not.toHaveBeenCalled();
  });

  it('pesan pribadi sah = handleInbound sekali dengan InboundMessage tepat', async () => {
    const res = await post(fx('message-private'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(handleInbound).toHaveBeenCalledTimes(1);
    const [deps, msg] = call(0);
    expect(msg).toEqual({
      messageId: 'false_628123456789@c.us_3EB0ABC123',
      from: '628123456789@c.us',
      chatType: 'private',
      fromMe: false,
      text: 'makan siang 25rb',
      senderPhone: null,
    });
    expect((deps as { env: WaEnv }).env).toBe(env);
  });

  it('tanpa Content-Type JSON tetap diproses', async () => {
    const res = await post(fx('message-private'), { 'content-type': 'text/plain' });
    expect(res.status).toBe(200);
    expect(handleInbound).toHaveBeenCalledTimes(1);
  });

  it('deps dan pool dibuat sekali per proses', async () => {
    await post(fx('message-private'));
    await post(fx('message-private'));
    expect(createPools).toHaveBeenCalledTimes(1);
    expect(call(0)[0]).toBe(call(1)[0]);
  });

  it('handleInbound melempar = tetap 200, log generik', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
    handleInbound.mockRejectedValue(new Error('628123456789 makan siang'));
    const res = await post(fx('message-private'));
    expect(res.status).toBe(200);
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/6281|makan/);
  });

  it('body > 64 kB lewat Content-Length = 413 tanpa membaca body', async () => {
    const arrayBuffer = vi.fn(() => Promise.resolve(new ArrayBuffer(1)));
    const req = {
      headers: new Headers({ 'content-length': '65537' }),
      arrayBuffer,
    } as unknown as Request;
    const spy = arrayBuffer;
    const res = await route.POST(req);
    expect(res.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
    expect(handleInbound).not.toHaveBeenCalled();
  });

  it('body > 64 kB lewat byte nyata = 413; tepat 64 kB lolos ke verifikasi', async () => {
    expect((await post(new Uint8Array(65537))).status).toBe(413);
    expect((await post(new Uint8Array(65536))).status).toBe(200);
  });

  it('BOM dan multibyte ditandatangani atas byte mentah = terverifikasi', async () => {
    const j = parseFx();
    j.data.body = 'kopi ☕ 25rb';
    const body = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(JSON.stringify(j), 'utf8'),
    ]);
    const res = await post(new Uint8Array(body));
    expect(res.status).toBe(200);
    expect(handleInbound).toHaveBeenCalledTimes(1);
    expect(call(0)[1]).toMatchObject({ text: 'kopi ☕ 25rb' });
  });

  it('hanya POST diekspor', () => {
    expect(Object.keys(route).sort()).toEqual(['POST', 'dynamic']);
    expect(route.dynamic).toBe('force-dynamic');
  });
});
