import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(dir, 'src'),
      '@dompetku/domain': path.join(dir, '../../packages/domain/src/index.ts'),
      '@dompetku/demo-data/select/kontribusi': path.join(
        dir,
        '../../packages/demo-data/src/select/kontribusi.ts',
      ),
      '@dompetku/demo-data': path.join(dir, '../../packages/demo-data/src/index.ts'),
      // `server-only` melempar di luar kondisi `react-server` Next; di Vitest jadi modul kosong.
      'server-only': path.join(dir, 'src/test/server-only.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // *.int.test.ts butuh Postgres: `pnpm test:int` (vitest.integration.config.ts).
    exclude: ['tests/e2e/**', 'node_modules/**', 'src/**/*.int.test.ts'],
  },
});
