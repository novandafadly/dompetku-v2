import { describe, expect, it } from 'vitest';
import { delaySeconds, throttleKey } from './throttle';
import { waitText } from './wait-text';

describe('delaySeconds (keputusan pemilik #4)', () => {
  it('5 gagal = 1 menit, 10 = 15 menit, 20 ke atas = 1 jam, tanpa kunci permanen', () => {
    expect([0, 4, 5, 9, 10, 19, 20, 500].map(delaySeconds)).toEqual([
      0, 0, 60, 60, 900, 900, 3600, 3600,
    ]);
  });
});

describe('throttleKey', () => {
  it('hash 32 byte, tidak peka huruf besar dan spasi, terpisah per jenis', () => {
    const a = throttleKey('password', 'akun', ' Novanda@Example.test ');
    expect(a).toHaveLength(32);
    expect(a.equals(throttleKey('password', 'akun', 'novanda@example.test'))).toBe(true);
    expect(a.equals(throttleKey('recovery', 'akun', 'novanda@example.test'))).toBe(false);
    expect(a.equals(throttleKey('password', 'ip', 'novanda@example.test'))).toBe(false);
  });
});

describe('waitText', () => {
  it('dibulatkan ke atas', () => {
    expect(waitText(1)).toBe('1 menit');
    expect(waitText(60)).toBe('1 menit');
    expect(waitText(61)).toBe('2 menit');
    expect(waitText(900)).toBe('15 menit');
    expect(waitText(3600)).toBe('1 jam');
  });
});
