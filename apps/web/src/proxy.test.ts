// @vitest-environment node
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it } from 'vitest';
import { config } from './proxy';

const matches = (url: string, headers?: Record<string, string>) =>
  unstable_doesMiddlewareMatch({ config, url, headers });

describe('matcher proxy', () => {
  // Next menyalin dan menahan seluruh body request yang melewati proxy (sampai
  // proxyClientMaxBodySize, 10 MiB) sebelum handler jalan; batas 64 KiB route webhook WhatsApp
  // baru berlaku sesudahnya. Route JSON itu tidak butuh nonce/CSP, jadi tidak lewat proxy.
  it.each(['/api/wa/webhook', '/api/wa/webhook?_rsc=1', '/api/wa/webhook/', '/api/wa/lain'])(
    '%s tidak lewat proxy',
    (url) => {
      expect(matches(url)).toBe(false);
    },
  );

  it.each(['/api/health', '/_next/static/chunks/a.js', '/favicon.ico', '/manifest.webmanifest'])(
    '%s tidak lewat proxy (aset, health)',
    (url) => {
      expect(matches(url)).toBe(false);
    },
  );

  it.each([
    '/',
    '/masuk',
    '/pribadi',
    '/pribadi/whatsapp',
    '/bersama/aktivitas',
    '/api/auth/sign-in/email',
    '/api/wallet',
    '/api/wa',
    '/api/waktu',
  ])('%s tetap lewat proxy (CSP bernonce, redirect masuk)', (url) => {
    expect(matches(url)).toBe(true);
  });

  it('prefetch router tidak lewat proxy', () => {
    expect(matches('/pribadi', { 'next-router-prefetch': '1' })).toBe(false);
    expect(matches('/pribadi', { purpose: 'prefetch' })).toBe(false);
  });
});
