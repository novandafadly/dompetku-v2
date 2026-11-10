import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { WaEnv } from './config';
import { createOpenWaTransport } from './openwa';

vi.mock('server-only', () => ({}));

const env: WaEnv = {
  webhookSecret: 'rahasia-webhook-1234',
  openwaUrl: 'http://127.0.0.1:2785',
  apiKey: 'kunci-api-rahasia',
  session: '8f3c2b1a-9d4e-4c7a-8b2f-1e6d5a4c3b2a',
  maxAmount: 1,
  ratePerMin: 1,
  botNumber: null,
};
const fx = (n: string) => readFileSync(join(__dirname, '__fixtures__', `${n}.json`), 'utf8');
const sign = (body: string, secret = env.webhookSecret) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('verify', () => {
  const t = createOpenWaTransport(env);
  const body = fx('message-private');
  it('menerima tanda tangan benar', () => {
    expect(t.verify(body, new Headers({ 'X-OpenWA-Signature': sign(body) }))).toBe(true);
  });
  it('menolak salah, hilang, beda panjang, body diubah', () => {
    expect(
      t.verify(body, new Headers({ 'X-OpenWA-Signature': sign(body, 'lain-lain-lain-lain') })),
    ).toBe(false);
    expect(t.verify(body, new Headers())).toBe(false);
    expect(t.verify(body, new Headers({ 'X-OpenWA-Signature': 'sha256=abc' }))).toBe(false);
    expect(t.verify(body, new Headers({ 'X-OpenWA-Signature': sign(body).slice(7) }))).toBe(false);
    expect(t.verify(body + ' ', new Headers({ 'X-OpenWA-Signature': sign(body) }))).toBe(false);
  });
});

describe('toInbound', () => {
  const t = createOpenWaTransport(env);
  it('pesan pribadi', () => {
    expect(t.toInbound(fx('message-private'))).toEqual({
      messageId: 'false_628123456789@c.us_3EB0ABC123',
      from: '628123456789@c.us',
      chatType: 'private',
      fromMe: false,
      text: 'makan siang 25rb',
    });
  });
  it('grup', () => {
    expect(t.toInbound(fx('message-group'))).toMatchObject({ chatType: 'group', fromMe: false });
  });
  it('fromMe', () => {
    expect(t.toInbound(fx('message-fromme'))).toMatchObject({ fromMe: true, chatType: 'private' });
  });
  it('non-teks', () => {
    expect(t.toInbound(fx('message-image'))).toMatchObject({ text: null });
  });
  it('pengirim @lid dipertahankan mentah', () => {
    expect(t.toInbound(fx('message-lid'))).toMatchObject({
      from: '99887766554433@lid',
      chatType: 'private',
    });
  });
  it('bukan pesan masuk / rusak', () => {
    expect(t.toInbound(fx('session-status'))).toBeNull();
    expect(t.toInbound('bukan json')).toBeNull();
    expect(t.toInbound('{"event":"message.received","data":{}}')).toBeNull();
    expect(t.toInbound('[]')).toBeNull();
  });
});

describe('sendText', () => {
  it('memanggil URL, header, dan body yang benar', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    await createOpenWaTransport(env, f).sendText('+62 812-3456-789', 'halo');
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:2785/api/sessions/${env.session}/messages/send-text`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'x-api-key': env.apiKey,
      'content-type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({ chatId: '628123456789@c.us', text: 'halo' });
  });
  it('melempar pada non-2xx tanpa membocorkan kunci', async () => {
    const f = vi.fn().mockResolvedValue(new Response(`gagal ${env.apiKey}`, { status: 401 }));
    const err = await createOpenWaTransport(env, f)
      .sendText('+628123', 'x')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('401');
    expect((err as Error).message).not.toContain(env.apiKey);
  });
  it('galat jaringan tidak membocorkan kunci', async () => {
    const f = vi.fn().mockRejectedValue(new Error(`connect ${env.apiKey}`));
    const err = await createOpenWaTransport(env, f)
      .sendText('+628123', 'x')
      .catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(env.apiKey);
  });
});
