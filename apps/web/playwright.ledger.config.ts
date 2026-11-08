import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E ledger mode nyata (S6, Task 19): Catat, Transaksi, Detail, Sampah, Dompet, Kategori di atas
 * ledger Postgres sungguhan, tanpa NEXT_PUBLIC_PROTOTYPE. Lingkungan sama dengan
 * `playwright.auth.config.ts`: AUTH_E2E_DATABASE_URL (dompetku_web) dan AUTH_E2E_ADMIN_URL
 * (superuser, reset data dan asersi baris) pada cluster yang sudah `dbmate up`; lalu `pnpm build`
 * dan `pnpm e2e:ledger`. Pemilik didaftarkan lewat alur nyata + passkey virtual (fixtures.ts).
 */
const port = 3301;
const dir = path.dirname(fileURLToPath(import.meta.url));
export const LEDGER_MAIL_FILE = path.join(dir, 'test-results', 'ledger-mail.jsonl');
/** storageState pemilik sesudah daftar + passkey; dihapus global-setup tiap run. */
export const LEDGER_OWNER_STATE = path.join(dir, 'test-results', 'ledger-owner.json');
const executablePath = process.env.PW_CHROMIUM_PATH;

const browser = {
  ...devices['Desktop Chrome'],
  ...(executablePath ? { launchOptions: { executablePath } } : {}),
};
/**
 * Spec yang mengisi data tanpa membersihkan; jalan sesudah project `kosong`. Regex dijangkarkan ke
 * awal nama berkas supaya `screens-s9-tagihan.spec.ts` tetap di `kosong`. Iterasi lokal satu spec
 * data tanpa menjalankan seluruh `kosong`: `--no-deps` (data harus bersih dari global-setup).
 */
const DATA_SPECS = [
  /[\\/]beranda-s9\.spec\.ts$/,
  /[\\/]laporan\.spec\.ts$/,
  /[\\/]s9-keluar\.spec\.ts$/,
  /[\\/]tagihan\.spec\.ts$/,
  /[\\/]vitals\.spec\.ts$/,
];

export default defineConfig({
  testDir: './tests/e2e-ledger',
  globalSetup: './tests/e2e-ledger/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Laporan HTML terpisah dari e2e:auth (job CI yang sama) agar tidak saling menimpa.
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-ledger' }]]
    : 'list',
  use: { baseURL: `http://localhost:${String(port)}`, trace: 'retain-on-failure' },
  // Urutan eksplisit (bukan urutan nama berkas): `kosong` = spec yang berasumsi ruang Pribadi/Bersama
  // kosong (ledger, s7, s9, screenshot); `data` = spec yang mengisi data dan tidak membersihkannya,
  // baru jalan sesudah `kosong` selesai (`dependencies`). `pnpm e2e:ledger` menjalankan keduanya.
  projects: [
    {
      name: 'kosong',
      testIgnore: DATA_SPECS,
      use: browser,
    },
    {
      name: 'data',
      testMatch: DATA_SPECS,
      dependencies: ['kosong'],
      use: browser,
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
      BETTER_AUTH_SECRET: 'e2e-ledger-bukan-rahasia-0123456789abcdefg',
      BETTER_AUTH_URL: `http://localhost:${String(port)}`,
      AUTH_EMAIL_FILE: LEDGER_MAIL_FILE,
      AUTH_CHECK_PWNED: '0',
    },
    url: `http://localhost:${String(port)}/api/health`,
    reuseExistingServer: false,
    stdout: 'pipe',
    timeout: 60_000,
  },
});
