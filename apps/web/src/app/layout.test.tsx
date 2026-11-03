import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('./fonts', () => ({ sans: { variable: 'font-sans' } }));
vi.mock('../styles/globals.css', () => ({}));

import { DemoRoot } from '@/features/shell/demo-root';
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
    expect(findAll(tree, DemoRoot)).toHaveLength(0);
    const [nav] = findAll(tree, NavProvider);
    expect(nav).toBeDefined();
    expect(nav?.props).toMatchObject({ prototype: false });
    expect(nav?.props).toHaveProperty('today');
  });

  it('mode prototipe memasang DemoProvider (DemoRoot, muat malas) di dalam NavProvider', async () => {
    vi.stubEnv('NEXT_PUBLIC_PROTOTYPE', '1');
    const tree = await RootLayout({ children: <main>isi</main> });
    const [nav] = findAll(tree, NavProvider);
    expect(nav?.props).toMatchObject({ prototype: true });
    expect(findAll(nav?.props.children, DemoRoot)).toHaveLength(1);
  });
});

describe('DemoProvider tidak diimpor statis dari JS mode nyata (K3)', () => {
  it('hanya demo-root yang mengimpor demo-provider, dan lewat import() dinamis', () => {
    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(src);
    const importers = files
      .filter((f) =>
        /['"](?:@\/features\/shell|\.)\/demo-provider['"]/.test(readFileSync(f, 'utf8')),
      )
      .map((f) => path.relative(src, f));
    expect(importers).toEqual(['features/shell/demo-root.tsx']);
    // Seed dan store demo hanya dibuat di DemoProvider.
    const seeders = files
      .filter((f) => /\bcreate(?:Seed|DemoStore)\b/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(src, f));
    expect(seeders).toEqual(['features/shell/demo-provider.tsx']);
    const root = readFileSync(path.join(src, 'features/shell/demo-root.tsx'), 'utf8');
    expect(root).toMatch(/import\(\s*'\.\/demo-provider'\s*\)/);
    expect(root).not.toMatch(/^import[^;]*demo-provider/m);
  });
});
