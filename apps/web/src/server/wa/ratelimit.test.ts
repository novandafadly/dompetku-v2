import { describe, expect, it } from 'vitest';
import { createLinkLimiter, createRateLimiter } from './ratelimit';

function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe('createRateLimiter', () => {
  it('mengizinkan sampai max di jendela, lalu menolak', () => {
    const c = clock();
    const l = createRateLimiter(3, 60_000, c.now);
    expect([l.allow('a'), l.allow('a'), l.allow('a'), l.allow('a')]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('kunci terpisah', () => {
    const c = clock();
    const l = createRateLimiter(1, 60_000, c.now);
    expect(l.allow('a')).toBe(true);
    expect(l.allow('b')).toBe(true);
    expect(l.allow('a')).toBe(false);
    expect(l.allow('b')).toBe(false);
  });

  it('jendela bergeser: slot kembali satu per satu saat hit tertua keluar jendela', () => {
    const c = clock();
    const l = createRateLimiter(2, 60_000, c.now);
    expect(l.allow('a')).toBe(true); // t=0
    c.advance(30_000);
    expect(l.allow('a')).toBe(true); // t=30s
    expect(l.allow('a')).toBe(false);
    c.advance(29_999); // t=59.999s: hit pertama masih di jendela
    expect(l.allow('a')).toBe(false);
    c.advance(1); // t=60s: hit pertama keluar
    expect(l.allow('a')).toBe(true);
    expect(l.allow('a')).toBe(false);
    c.advance(30_000); // t=90s: hit t=30s keluar
    expect(l.allow('a')).toBe(true);
  });

  it('penolakan tidak dihitung sebagai hit', () => {
    const c = clock();
    const l = createRateLimiter(1, 1000, c.now);
    expect(l.allow('a')).toBe(true);
    for (let i = 0; i < 5; i++) expect(l.allow('a')).toBe(false);
    c.advance(1000);
    expect(l.allow('a')).toBe(true);
  });

  it('batas dan jendela dapat diatur', () => {
    const c = clock();
    const l = createRateLimiter(5, 10, c.now);
    for (let i = 0; i < 5; i++) expect(l.allow('k')).toBe(true);
    expect(l.allow('k')).toBe(false);
    c.advance(10);
    expect(l.allow('k')).toBe(true);
  });

  it('kunci lama dibersihkan (tidak menahan slot setelah jendela lewat)', () => {
    const c = clock();
    const l = createRateLimiter(1, 1000, c.now);
    for (let i = 0; i < 100; i++) l.allow(`k${String(i)}`);
    c.advance(1000);
    for (let i = 0; i < 100; i++) expect(l.allow(`k${String(i)}`)).toBe(true);
    expect(l.size()).toBe(100);
    c.advance(5000);
    l.allow('baru');
    expect(l.size()).toBe(1);
  });

  it('argumen tidak sah = RangeError', () => {
    expect(() => createRateLimiter(0, 1000)).toThrow(RangeError);
    expect(() => createRateLimiter(1.5, 1000)).toThrow(RangeError);
    expect(() => createRateLimiter(1, 0)).toThrow(RangeError);
  });
});

describe('createLinkLimiter', () => {
  const HOUR = 3_600_000;

  it('5 percobaan per jam per nomor', () => {
    const c = clock();
    const l = createLinkLimiter(c.now);
    for (let i = 0; i < 5; i++) expect(l.allow('+6281111111111')).toBe(true);
    expect(l.allow('+6281111111111')).toBe(false);
    expect(l.allow('+6282222222222')).toBe(true);
    c.advance(HOUR);
    expect(l.allow('+6281111111111')).toBe(true);
  });

  it('30 percobaan per jam global (semua nomor)', () => {
    const c = clock();
    const l = createLinkLimiter(c.now);
    for (let i = 0; i < 30; i++)
      expect(l.allow(`+62811000000${String(i).padStart(2, '0')}`)).toBe(true);
    expect(l.allow('+6289999999999')).toBe(false);
    c.advance(HOUR);
    expect(l.allow('+6289999999999')).toBe(true);
  });

  it('nomor yang sudah habis jatahnya tidak memakan jatah global', () => {
    const c = clock();
    const l = createLinkLimiter(c.now);
    for (let i = 0; i < 5; i++) l.allow('+6281111111111');
    for (let i = 0; i < 50; i++) expect(l.allow('+6281111111111')).toBe(false);
    for (let i = 0; i < 25; i++)
      expect(l.allow(`+62822000000${String(i).padStart(2, '0')}`)).toBe(true);
    expect(l.allow('+6283333333333')).toBe(false);
  });
});
