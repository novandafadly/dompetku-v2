import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const { parseSetCookie } = await import('./next');

describe('parseSetCookie', () => {
  it('membaca atribut dan membuka encoding nilai', () => {
    expect(
      parseSetCookie(
        '__Host-dompetku.session_token=abc.def%3D; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax',
      ),
    ).toEqual({
      name: '__Host-dompetku.session_token',
      value: 'abc.def=',
      maxAge: 604800,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });
  });

  it('cookie dihapus (Max-Age=0) tetap terbaca', () => {
    expect(parseSetCookie('x=; Max-Age=0; Path=/')).toMatchObject({
      name: 'x',
      value: '',
      maxAge: 0,
    });
  });

  it('baris rusak diabaikan', () => {
    expect(parseSetCookie('tanpa-sama-dengan')).toBeNull();
  });
});
