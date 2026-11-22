import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Tanpa jaringan keluar: fetch global hanya ke loopback (src/test-setup.ts).
    setupFiles: ['src/test-setup.ts'],
    // src/__int__ butuh Postgres termigrasi: `pnpm --filter @dompetku/worker test:int`.
    exclude: ['node_modules/**', 'src/__int__/**'],
  },
});
