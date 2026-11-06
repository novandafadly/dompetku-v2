import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useNavItems } from './nav-items';
import { RencanaContext } from './rencana-context';

vi.mock('./nav-provider', () => ({ useNav: () => ({ ruang: 'pribadi' }) }));

const tabs = (wrapper?: (p: { children: ReactNode }) => ReactNode) =>
  renderHook(() => useNavItems(), wrapper ? { wrapper } : {}).result.current.map((i) => i.tab);

describe('useNavItems: tab Rencana (K8 S9)', () => {
  it('mode nyata (tanpa provider): Rencana selalu tampil, ruang kosong pun', () => {
    expect(tabs()).toContain('rencana');
  });

  it('prototipe (DemoProvider mengisi konteks): tersembunyi bila ruang belum punya rencana', () => {
    expect(
      tabs(({ children }) => (
        <RencanaContext.Provider value={{ pribadi: false, bersama: false }}>
          {children}
        </RencanaContext.Provider>
      )),
    ).not.toContain('rencana');
    expect(
      tabs(({ children }) => (
        <RencanaContext.Provider value={{ pribadi: true, bersama: false }}>
          {children}
        </RencanaContext.Provider>
      )),
    ).toContain('rencana');
  });
});
