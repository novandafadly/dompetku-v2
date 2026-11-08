// Pemeriksa registry ID tes (qa.md R1). Jalankan: node scripts/check-test-registry.ts [akar-repo]
// Galat (keluar 1) bila: (a) ID berstatus `aktif` dengan milestone <= M2 tanpa tag di tes mana pun,
// atau (b) ada tag yang tidak terdaftar di packages/db/tests/REGISTRY.md.
// Format tag (hanya ini yang dikenali):
//   pgTAP       baris `-- ID: B3, B6` (juga `[B4]` di deskripsi asersi)
//   Vitest      `[B20]` di judul tes (string), dalam berkas *.test.ts(x)
//   Playwright  `{ tag: ['@B20'] }` di berkas *.spec.ts
// Keluaran hanya ID dan berkas.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_MILESTONE = 2;
const ID = String.raw`(?:BR|[ITSBCZK])\d+`;
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  '.git',
  'test-results',
  'playwright-report',
]);

interface Entry {
  id: string;
  milestone: number;
  status: string;
}

export function parseRegistry(text: string): Entry[] {
  const rows: Entry[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    const [id, , milestone, status] = cells;
    const m = /^M(\d+)$/.exec(milestone ?? '');
    if (!id || !new RegExp(`^${ID}$`).test(id) || !m) continue;
    rows.push({ id, milestone: Number(m[1]), status: (status ?? '').toLowerCase() });
  }
  return rows;
}

function walk(dir: string, out: string[]): void {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) {
      if (!SKIP_DIRS.has(d.name)) walk(join(dir, d.name), out);
    } else out.push(join(dir, d.name));
  }
}

function safeWalk(dir: string): string[] {
  const out: string[] = [];
  try {
    walk(dir, out);
  } catch {
    // direktori tidak ada: lewati
  }
  return out;
}

// Mengembalikan ID yang ditemukan di satu berkas menurut formatnya.
export function tagsIn(file: string, text: string): string[] {
  const found: string[] = [];
  const bracket = new RegExp(String.raw`(?<![\w\]\-])\[(${ID})\]`, 'g');
  if (file.endsWith('.sql')) {
    for (const m of text.matchAll(/^[ \t]*--[ \t]*ID:[ \t]*(.+)$/gm)) {
      for (const t of (m[1] ?? '').split(/[\s,]+/)) if (t) found.push(t);
    }
    for (const m of text.matchAll(bracket)) found.push(m[1] ?? '');
  } else {
    if (/\.test\.tsx?$/.test(file) || file.endsWith('.spec.ts')) {
      for (const m of text.matchAll(bracket)) found.push(m[1] ?? '');
    }
    if (file.endsWith('.spec.ts')) {
      for (const blok of text.matchAll(/\btag:\s*(\[[^\]]*\]|'[^'\n]*'|"[^"\n]*")/g)) {
        for (const m of (blok[1] ?? '').matchAll(
          /(?<![\w@])@([A-Z][\w-]*|(?:br|[itsbczk])\d[\w-]*)/g, // tag kapital atau salah huruf kecil (@b20, @br1) harus ID registry
        )) {
          found.push(m[1] ?? '');
        }
      }
    }
  }
  return found;
}

export function check(root: string): {
  missing: string[];
  unknown: { id: string; file: string }[];
} {
  const registry = parseRegistry(readFileSync(join(root, 'packages/db/tests/REGISTRY.md'), 'utf8'));
  const known = new Set(registry.map((e) => e.id));
  const files = [
    ...safeWalk(join(root, 'packages/db/tests')).filter((f) => f.endsWith('.sql')),
    ...safeWalk(join(root, 'apps')).filter((f) => /\.test\.tsx?$|\.spec\.ts$/.test(f)),
    ...safeWalk(join(root, 'packages')).filter(
      (f) => !f.includes(join(root, 'packages/db/tests')) && /\.test\.tsx?$|\.spec\.ts$/.test(f),
    ),
  ];
  const tagged = new Set<string>();
  const unknown: { id: string; file: string }[] = [];
  for (const f of files) {
    for (const id of tagsIn(f, readFileSync(f, 'utf8'))) {
      if (known.has(id)) tagged.add(id);
      else unknown.push({ id, file: relative(root, f) });
    }
  }
  const missing = registry
    .filter((e) => e.status === 'aktif' && e.milestone <= MAX_MILESTONE && !tagged.has(e.id))
    .map((e) => e.id);
  return { missing, unknown };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const { missing, unknown } = check(root);
  for (const id of missing) console.error(`tanpa tag: ${id}`);
  for (const u of unknown) console.error(`tag tidak ada di registry: ${u.id} (${u.file})`);
  process.exit(missing.length > 0 || unknown.length > 0 ? 1 : 0);
}
