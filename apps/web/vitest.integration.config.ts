import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Tes integrasi auth terhadap Postgres sungguhan (packages/db/README.md "Tes integrasi auth").
 * Butuh TEST_DATABASE_URL (dompetku_web) dan TEST_DATABASE_ADMIN_URL (superuser, untuk
 * membersihkan data antar tes) pada cluster sekali pakai yang sudah `dbmate up`.
 */
export default defineConfig({
  resolve: { alias: { '@': path.join(dir, 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
