import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * Generator tangkapan layar portofolio otomatis (M7 / S19):
 * menghasilkan PNG 390×844 dan 1280×800 (tema gelap & terang) dari seed demo 100% fiktif
 * (Raka & Nadia) di atas Postgres lokal sekali pakai — tidak pernah dari data produksi.
 *
 * Tidak berjalan di `pnpm e2e` biasa maupun CI harian. Jalankan lokal sesudah `pnpm build`:
 *   AUTH_E2E_DATABASE_URL="postgres://dompetku_web@127.0.0.1:5432/dompetku?sslmode=disable" \
 *   AUTH_E2E_ADMIN_URL="postgres://postgres@127.0.0.1:5432/dompetku?sslmode=disable" \
 *   pnpm e2e:portfolio
 */
const port = 3304;
const dir = path.dirname(fileURLToPath(import.meta.url));
export const PORTFOLIO_MAIL_FILE = path.join(dir, 'test-results', 'portfolio-mail.jsonl');
export const PORTFOLIO_OWNER_STATE = path.join(dir, 'test-results', 'portfolio-owner.json');
export const PORTFOLIO_PARTNER_STATE = path.join(dir, 'test-results', 'portfolio-partner.json');
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests/e2e-portfolio',
  globalSetup: './tests/e2e-portfolio/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  retries: 1,
  timeout: 120_000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${String(port)}`,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'portfolio',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: {
    command: [
      'rm -rf .next/standalone/apps/web/.next/static',
      'cp -r .next/static .next/standalone/apps/web/.next/static',
      '(test ! -d public || cp -r public .next/standalone/apps/web/public)',
      `PORT=${String(port)} HOSTNAME=127.0.0.1 node .next/standalone/apps/web/server.js`,
    ].join(' && '),
    env: {
      DATABASE_URL: process.env.AUTH_E2E_DATABASE_URL ?? '',
      BETTER_AUTH_SECRET: 'e2e-'.repeat(8),
      BETTER_AUTH_URL: `http://localhost:${String(port)}`,
      AUTH_EMAIL_FILE: PORTFOLIO_MAIL_FILE,
      AUTH_CHECK_PWNED: '0',
      RECEIPT_ENCRYPTION_KEY: '11'.repeat(32),
    },
    url: `http://localhost:${String(port)}/api/health`,
    reuseExistingServer: false,
    stdout: 'pipe',
    timeout: 60_000,
  },
});
