// Tes pemeriksa registry ID tes (node --test). Memanggil CLI terhadap pohon contoh sementara.
/* eslint-disable @typescript-eslint/no-floating-promises -- API node:test: describe/it tidak perlu di-await */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-test-registry.ts');
const roots: string[] = [];

const REGISTRY = `# Registry
| ID | Maksud | Milestone | Status | Lokasi |
| --- | --- | --- | --- | --- |
| B2 | isolasi | M1 | aktif | a.sql |
| B20 | feed | M1 | aktif | b.test.ts |
| B21 | contoh M3 | M3 | aktif | - |
| B16 | net worth | M1 | belum | - |
`;

function sample(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'registry-'));
  roots.push(root);
  const all: Record<string, string> = { 'packages/db/tests/REGISTRY.md': REGISTRY, ...files };
  for (const [rel, body] of Object.entries(all)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

function run(root: string) {
  const r = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe('check-test-registry', () => {
  it('lengkap: semua ID aktif M<=2 bertag, keluar 0', () => {
    const root = sample({
      'packages/db/tests/01.sql': '-- ID: B2\nselect 1;\n',
      'apps/web/src/x.test.ts': "it('feed [B20]', () => {});\n",
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  it('ID aktif M<=2 tanpa tag: keluar 1 dan menyebut ID', () => {
    const root = sample({ 'packages/db/tests/01.sql': '-- ID: B2\n' });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /B20/);
    assert.doesNotMatch(out, /B21|B16/);
  });

  it('tag tak dikenal: keluar 1 dan menyebut ID serta berkas', () => {
    const root = sample({
      'packages/db/tests/01.sql': '-- ID: B2, B99\n',
      'apps/web/src/x.test.ts': "it('feed [B20]', () => {});\n",
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /B99/);
    assert.match(out, /01\.sql/);
  });

  it('format tag Playwright dan Vitest dikenali; [B2] tidak dianggap B20', () => {
    const root = sample({
      'packages/db/tests/01.sql': '-- ID: B2\n',
      'apps/web/tests/e2e/a.spec.ts': "test('x', { tag: ['@B20'] }, async () => {});\n",
    });
    assert.equal(run(root).code, 0);
    const root2 = sample({
      'packages/db/tests/01.sql': '-- ID: B2\n',
      'apps/web/src/x.test.ts': "it('a [B2]', () => {});\n",
    });
    const { code, out } = run(root2);
    assert.equal(code, 1);
    assert.match(out, /B20/);
  });

  it('tidak ada positif palsu: email, kelas CSS, indeks array, ID mirip', () => {
    const root = sample({
      'packages/db/tests/01.sql': '-- ID: B2\nselect arr[B9];\n',
      'apps/web/src/x.test.ts': [
        "it('feed [B20]', () => {});",
        "const a = 'x@B77.com'; const c = 'bg-[B88]'; const d = items[B66];",
        "const e = '@B55 tanpa tag:'; const f = `[B44x]`;",
      ].join('\n'),
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  it('tag Playwright bentuk salah (@B20x, @b20, @br1) atau ID di luar registry: keluar 1; @screens lolos', () => {
    for (const tag of ['@B20x', '@B77', '@Z', '@b20', '@br1']) {
      const root = sample({
        'packages/db/tests/01.sql': '-- ID: B2\n',
        'apps/web/src/x.test.ts': "it('feed [B20]', () => {});\n",
        'apps/web/tests/e2e/a.spec.ts': `test('x', { tag: ['${tag}'] }, async () => {});\n`,
      });
      const { code, out } = run(root);
      assert.equal(code, 1, tag);
      assert.match(out, new RegExp(tag.slice(1)));
    }
    const okRoot = sample({
      'packages/db/tests/01.sql': '-- ID: B2\n',
      'apps/web/src/x.test.ts': "it('feed [B20]', () => {});\n",
      'apps/web/tests/e2e/a.spec.ts': "test('x', { tag: '@screens' }, async () => {});\n",
    });
    assert.equal(run(okRoot).code, 0);
  });

  it('tag di node_modules diabaikan', () => {
    const root = sample({
      'packages/db/tests/01.sql': '-- ID: B2\n',
      'apps/web/src/x.test.ts': "it('feed [B20]', () => {});\n",
      'apps/web/node_modules/p/y.test.ts': "it('[B99]', () => {});\n",
    });
    assert.equal(run(root).code, 0);
  });
});
