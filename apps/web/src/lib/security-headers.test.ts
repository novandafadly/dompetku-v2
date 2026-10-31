import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, createNonce } from './security-headers';

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split(';').map((d) => {
      const [name = '', ...values] = d.trim().split(/\s+/);
      return [name, values.join(' ')];
    }),
  );
}

describe('contentSecurityPolicy', () => {
  it('produksi: script dan style hanya lewat nonce, tanpa unsafe-inline/eval', () => {
    const d = directives(contentSecurityPolicy('abc'));
    expect(d.get('script-src')).toBe("'nonce-abc' 'strict-dynamic'");
    expect(d.get('style-src')).toBe("'self' 'nonce-abc'");
    expect(d.get('frame-ancestors')).toBe("'none'");
    expect(d.get('object-src')).toBe("'none'");
    expect(d.get('base-uri')).toBe("'none'");
    expect(d.get('form-action')).toBe("'self'");
    expect(d.get('connect-src')).toBe("'self'");
    expect(d.get('img-src')).toBe("'self' data:");
    expect(contentSecurityPolicy('abc')).not.toMatch(/unsafe-eval/);
    expect(d.get('style-src')).not.toMatch(/unsafe-inline/);
  });

  it('dev: unsafe-eval untuk React dan style inline untuk HMR', () => {
    const d = directives(contentSecurityPolicy('abc', true));
    expect(d.get('script-src')).toContain("'unsafe-eval'");
    expect(d.get('style-src')).toBe("'self' 'unsafe-inline'");
  });
});

describe('createNonce', () => {
  it('acak, base64, 128 bit', () => {
    const a = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(a);
  });
});
