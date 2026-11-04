// Bundel worker jadi satu berkas ESM untuk image web (/app/worker/worker.mjs).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/worker.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  // pg memuat pg-native secara opsional; tidak dipasang.
  external: ['pg-native'],
  // Paket CJS di dalam bundel ESM butuh require() asli Node.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  legalComments: 'none',
  logLevel: 'info',
});
