import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('./fonts', () => ({ sans: { variable: 'font-sans' } }));
vi.mock('../styles/globals.css', () => ({}));

import { DemoProvider } from '@/features/shell/demo-provider';
import { NavProvider } from '@/features/shell/nav-provider';
import RootLayout from './layout';

/** Semua elemen di pohon (belum dirender) yang bertipe `type`. */
function findAll(node: ReactNode, type: unknown): ReactElement<{ children?: ReactNode }>[] {
  const found: ReactElement<{ children?: ReactNode }>[] = [];
  const walk = (n: ReactNode) => {
    for (const child of Children.toArray(n)) {
      if (!isValidElement<{ children?: ReactNode }>(child)) continue;
      if (child.type === type) found.push(child);
      walk(child.props.children);
    }
  };
  walk(node);
  return found;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('RootLayout', () => {
  it('mode nyata tanpa DemoProvider', async () => {
    vi.stubEnv('NEXT_PUBLIC_PROTOTYPE', '');
    const tree = await RootLayout({ children: <main>isi</main> });
    expect(findAll(tree, DemoProvider)).toHaveLength(0);
    const [nav] = findAll(tree, NavProvider);
    expect(nav).toBeDefined();
    expect(nav?.props).toMatchObject({ prototype: false });
    expect(nav?.props).toHaveProperty('today');
  });

  it('mode prototipe memasang DemoProvider di dalam NavProvider', async () => {
    vi.stubEnv('NEXT_PUBLIC_PROTOTYPE', '1');
    const tree = await RootLayout({ children: <main>isi</main> });
    const [nav] = findAll(tree, NavProvider);
    expect(nav?.props).toMatchObject({ prototype: true });
    expect(findAll(nav?.props.children, DemoProvider)).toHaveLength(1);
  });
});
