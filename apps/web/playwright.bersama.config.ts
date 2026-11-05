import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E dua user (S8, Task 5): Novanda (pemilik) dan Farida (pasangan, lewat undangan sungguhan)
 * di ledger Postgres nyata. Terpisah dari `e2e:ledger` karena `s7.spec` dan `screens-s7` bergantung
 * pada Bersama solo. Lingkungan sama dengan `playwright.ledger.config.ts` (AUTH_E2E_DATABASE_URL,
 * AUTH_E2E_ADMIN_URL); lalu `pnpm build` dan `pnpm e2e:bersama`.
 */
const port = 3302;
const dir = path.dirname(fileURLToPath(import.meta.url));
export const BERSAMA_MAIL_FILE = path.join(dir, 'test-results', 'bersama-mail.jsonl');
/** storageState pemilik sesudah daftar + passkey; dihapus global-setup tiap run. */
export const BERSAMA_OWNER_STATE = path.join(dir, 'test-results', 'bersama-owner.json');
/** storageState Farida sesudah menerima undangan + TOTP; dihapus global-setup tiap run. */
export const BERSAMA_PARTNER_STATE = path.join(dir, 'test-results', 'bersama-partner.json');
const executablePath = process.env.PW_CHROMIUM_PATH;

// SCREENS=1 hanya menjalankan tes @screens (screenshot critique); selain itu dilewati.
const screens = process.env.SCREENS === '1';

export default defineConfig({
  testDir: './tests/e2e-bersama',
  ...(screens ? { grep: /@screens/ } : { grepInvert: /@screens/ }),
  globalSetup: './tests/e2e-bersama/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Laporan HTML terpisah dari e2e:auth (job CI yang sama) agar tidak saling menimpa.
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-bersama' }]]
    : 'list',
  use: { baseURL: `http://localhost:${String(port)}`, trace: 'retain-on-failure' },
  // `bergabung.spec` harus jalan sebelum fixture `kanari` mengisi Pribadi N dan F (S8-O1: Pribadi F
  // masih kosong), jadi proyeknya sendiri dan proyek utama bergantung padanya.
  projects: [
    {
      name: 'bergabung',
      testMatch: /bergabung\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
    {
      name: 'chromium',
      testIgnore: /bergabung\.spec\.ts$/,
      dependencies: ['bergabung'],
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
      BETTER_AUTH_SECRET: 'e2e-bersama-bukan-rahasia-0123456789abcdefg',
      BETTER_AUTH_URL: `http://localhost:${String(port)}`,
      AUTH_EMAIL_FILE: BERSAMA_MAIL_FILE,
      AUTH_CHECK_PWNED: '0',
    },
    url: `http://localhost:${String(port)}/api/health`,
    reuseExistingServer: false,
    stdout: 'pipe',
    timeout: 60_000,
  },
});
