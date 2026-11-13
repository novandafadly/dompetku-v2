import { describe, expect, it } from 'vitest';
import { buildDebtHref, buildDebtListHref, buildKontakHref } from './utang-hrefs';

describe('alamat Utang dan Kontak (S11)', () => {
  it('daftar, detail, dan Kontak; query yang dibawa tetap ada', () => {
    expect(buildDebtListHref('pribadi', '')).toBe('/pribadi/rencana?bagian=utang');
    expect(buildDebtListHref('pribadi', '?theme=light')).toBe(
      '/pribadi/rencana?theme=light&bagian=utang',
    );
    expect(buildDebtHref('pribadi', 'abc', '?theme=dark')).toBe(
      '/pribadi/rencana/utang/abc?theme=dark',
    );
    expect(buildKontakHref('pribadi', '')).toBe('/pribadi/kontak');
    expect(buildKontakHref('pribadi', '?theme=dark')).toBe('/pribadi/kontak?theme=dark');
  });
});
