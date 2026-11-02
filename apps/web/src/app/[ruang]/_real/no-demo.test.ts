import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Review Focus 5: mode nyata tidak pernah jatuh ke seed. Setiap modul `_real/*` dan semua modul
 * yang dicapainya lewat impor runtime (relatif atau `@/`) tidak boleh mengimpor
 * `@dompetku/demo-data` selain `import type`/`export type` (dihapus saat kompilasi).
 *
 * Satu-satunya pengecualian: `RuangShell` dipakai kedua mode (satu entri klien di layout, demi
 * anggaran JS) dan memuat malas sheet demo hanya bila `real` kosong (prototipe). Jalur itu
 * dibuktikan tidak pernah dimuat di mode nyata oleh `../ruang-shell.test.tsx`; di sini dicatat
 * persis satu sisi impor dinamis itu, sisi baru apa pun tetap gagal.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../..');

const IMPORT =
  /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

interface Spec {
  spec: string;
  dynamic: boolean;
}

function runtimeImports(code: string): Spec[] {
  const out: Spec[] = [];
  for (const m of code.matchAll(IMPORT)) {
    const dynamic = m[4];
    if (dynamic !== undefined) {
      out.push({ spec: dynamic, dynamic: true });
      continue;
    }
    if (m[2] !== undefined) continue; // import type / export type
    const spec = m[3];
    if (spec !== undefined) out.push({ spec, dynamic: false });
  }
  return out;
}

const runtimeSpecifiers = (code: string): string[] => runtimeImports(code).map((s) => s.spec);

/** Impor dinamis bergerbang mode (lihat komentar berkas): `dari → ke`, relatif ke `src`. */
const GATED = 'app/[ruang]/ruang-shell.tsx → app/[ruang]/catat-demo.tsx';

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(src, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const p = base + ext;
    if (ext === '' && !/\.(ts|tsx)$/.test(p)) continue;
    if (existsSync(p)) return p;
  }
  return null;
}

function realEntries(): string[] {
  return readdirSync(here)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
    .map((f) => path.join(here, f));
}

/** Modul yang dicapai lewat impor runtime + modul yang mengimpor demo-data saat runtime. */
function scan(entries: string[]): { seen: Set<string>; offenders: string[]; gated: string[] } {
  const seen = new Set<string>();
  const offenders: string[] = [];
  const gated: string[] = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const { spec, dynamic } of runtimeImports(readFileSync(file, 'utf8'))) {
      if (spec === '@dompetku/demo-data' || spec.startsWith('@dompetku/demo-data/')) {
        offenders.push(path.relative(src, file));
        continue;
      }
      const next = resolve(file, spec);
      if (next === null) continue;
      const edge = `${path.relative(src, file)} → ${path.relative(src, next)}`;
      if (dynamic && edge === GATED) {
        gated.push(edge);
        continue;
      }
      queue.push(next);
    }
  }
  return { seen, offenders, gated };
}

describe('_real tanpa data demo saat runtime', () => {
  it('pemindai mengenali impor runtime dan mengabaikan impor tipe', () => {
    expect(
      runtimeSpecifiers(
        [
          "import type { Ruang } from '@dompetku/demo-data';",
          "import { x } from '@dompetku/demo-data';",
          "export { y } from './y';",
          "export type { Z } from './z';",
          "const m = () => import('./lazy');",
          "import './side-effect';",
        ].join('\n'),
      ),
    ).toEqual(['@dompetku/demo-data', './y', './lazy', './side-effect']);
  });

  it('semua modul yang dicapai dari _real/* tidak mengimpor @dompetku/demo-data', () => {
    const entries = realEntries();
    expect(entries.map((f) => path.basename(f))).toEqual(
      expect.arrayContaining([
        'beranda.tsx',
        'ruang-shell-real.tsx',
        'catat-source-real.ts',
        'transaksi.tsx',
      ]),
    );
    const { seen, offenders, gated } = scan(entries);
    expect(gated).toEqual([GATED]);
    // Pemindai benar-benar menelusuri: sheet Catat dan presenter ikut tercapai.
    const reached = [...seen].map((f) => path.relative(src, f));
    expect(reached).toEqual(
      expect.arrayContaining([
        'features/catat/catat-sheet.tsx',
        'features/beranda/safe-to-spend-view.tsx',
        'features/ledger/present.ts',
        'features/transaksi/entry-row-view.tsx',
        'features/transaksi/summary-view-vm.tsx',
        'features/transaksi/transaksi-layout.tsx',
        'features/ledger/group-by-day.ts',
      ]),
    );
    expect(offenders).toEqual([]);
  });
});
