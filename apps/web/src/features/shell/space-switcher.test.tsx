import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/pribadi/beranda';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams('?seed=full'),
}));

import { NavProvider } from './nav-provider';
import { SpaceSwitcher } from './space-switcher';

function hrefOf(name: string): string | null {
  render(
    <NavProvider today="2026-10-31" prototype>
      <SpaceSwitcher />
    </NavProvider>,
  );
  return screen.getByRole('link', { name }).getAttribute('href');
}

beforeEach(() => {
  pathname = '/pribadi/beranda';
});

describe('SpaceSwitcher', () => {
  it('pindah ruang tetap di tab yang sama', () => {
    pathname = '/pribadi/dompet';
    expect(hrefOf('Bersama')).toBe('/bersama/dompet?seed=full');
  });

  it('dari Sampah tetap di Sampah ruang lain (bukan Beranda)', () => {
    pathname = '/pribadi/sampah';
    expect(hrefOf('Bersama')).toBe('/bersama/sampah?seed=full');
  });

  it('dari Kategori tetap di Kategori ruang lain', () => {
    pathname = '/bersama/kategori';
    expect(hrefOf('Pribadi')).toBe('/pribadi/kategori?seed=full');
  });
});
