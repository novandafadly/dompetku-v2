import { defineConfig, devices } from '@playwright/test';

const port = 3100;
// Sandbox lokal: Chromium sudah terpasang di luar paket. CI memakai browser bawaan image.
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
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
    // Jalankan build standalone yang sama dengan produksi (butuh `pnpm build` lebih dulu).
    command: [
      'rm -rf .next/standalone/apps/web/.next/static',
      'cp -r .next/static .next/standalone/apps/web/.next/static',
      '(test ! -d public || cp -r public .next/standalone/apps/web/public)',
      `NEXT_PUBLIC_DEMO=1 PORT=${port} HOSTNAME=127.0.0.1 node .next/standalone/apps/web/server.js`,
    ].join(' && '),
    url: `http://127.0.0.1:${port}/pribadi/beranda`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
