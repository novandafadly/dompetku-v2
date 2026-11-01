import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E alur auth sungguhan (mode non-prototipe) terhadap Postgres sekali pakai.
 * Butuh AUTH_E2E_DATABASE_URL (dompetku_web) dan AUTH_E2E_ADMIN_URL (superuser, reset data)
 * pada cluster yang sudah `dbmate up`; lalu `pnpm build` dan `pnpm e2e:auth`.
 * Email ditulis ke berkas (AUTH_EMAIL_FILE), passkey memakai autentikator virtual Chromium.
 */
const port = 3300;
const dir = path.dirname(fileURLToPath(import.meta.url));
export const MAIL_FILE = path.join(dir, 'test-results', 'auth-mail.jsonl');
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests/e2e-auth',
  globalSetup: './tests/e2e-auth/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${String(port)}`, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
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
      BETTER_AUTH_SECRET: 'e2e-auth-bukan-rahasia-0123456789abcdefgh',
      BETTER_AUTH_URL: `http://localhost:${String(port)}`,
      AUTH_EMAIL_FILE: MAIL_FILE,
      AUTH_CHECK_PWNED: '0',
    },
    url: `http://localhost:${String(port)}/api/health`,
    reuseExistingServer: false,
    stdout: 'pipe',
    timeout: 60_000,
  },
});
