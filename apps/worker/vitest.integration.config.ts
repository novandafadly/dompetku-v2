import { defineConfig } from 'vitest/config';

/**
 * Tes integrasi worker terhadap Postgres sungguhan yang sudah `dbmate up`.
 * Butuh TEST_WORKER_DATABASE_URL (dompetku_worker) dan TEST_DATABASE_ADMIN_URL (superuser,
 * hanya untuk menyiapkan dan memeriksa baris jobs.job_runs).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__int__/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
