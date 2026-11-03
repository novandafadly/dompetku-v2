import { access } from 'node:fs/promises';
import { test as base, expect, type Browser } from '@playwright/test';
import pg from 'pg';
import { LEDGER_MAIL_FILE, LEDGER_OWNER_STATE } from '../../playwright.ledger.config';
import { addPasskeyAuthenticator, lastMail, linkIn } from '../e2e-auth/helpers';
import { OWNER } from './global-setup';

const PASSWORD = 'kuda-lari-di-sawah-42';

/**
 * Pemilik lewat alur nyata (AFD §1): buat akun dari allowlist, konfirmasi email, masuk, amankan
 * dengan passkey (autentikator virtual), kode pemulihan, sampai Beranda. Sesi disimpan sebagai
 * storageState dan dipakai semua tes; worker yang dimulai ulang sesudah tes gagal memakai berkas
 * yang sama (pemilik hanya bisa didaftarkan sekali per run).
 */
async function registerOwner(browser: Browser, baseURL: string): Promise<void> {
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await page.goto('/buat-akun');
    await page.getByLabel('Email').fill(OWNER);
    await page.getByLabel('Nama panggilan').fill('Novanda');
    await page.getByLabel('Kata sandi baru').fill(PASSWORD);
    await page.getByRole('button', { name: 'Buat akun' }).click();
    await expect(page.getByRole('heading', { name: 'Periksa email' })).toBeVisible();
    await page.goto(linkIn((await lastMail(/Konfirmasi email/, LEDGER_MAIL_FILE)).text));
    await page.getByRole('button', { name: 'Konfirmasi email' }).click();
    await expect(page.getByText('Email terkonfirmasi.')).toBeVisible();
    await page.getByLabel('Email').fill(OWNER);
    await page.getByLabel('Kata sandi', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page).toHaveURL(/\/amankan$/);
    await addPasskeyAuthenticator(page);
    await page.getByRole('button', { name: 'Buat passkey' }).click();
    await page.getByRole('button', { name: 'Buat kode pemulihan' }).click();
    await page.getByLabel('Saya sudah menyimpan kode ini di tempat yang aman.').check();
    await page.getByRole('button', { name: 'Selesai' }).click();
    await expect(page).toHaveURL(/\/pribadi\/beranda$/);
    await context.storageState({ path: LEDGER_OWNER_STATE });
  } finally {
    await context.close();
  }
}

/** Satu kueri superuser (asersi baris; tidak pernah dipakai untuk menulis data uji). */
export async function adminQuery<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const admin = new pg.Client({ connectionString: process.env.AUTH_E2E_ADMIN_URL });
  await admin.connect();
  try {
    return (await admin.query<T>(sql, params)).rows;
  } finally {
    await admin.end();
  }
}

export const test = base.extend<object, { ownerState: string }>({
  ownerState: [
    async ({ browser }, provide, workerInfo) => {
      const exists = await access(LEDGER_OWNER_STATE).then(
        () => true,
        () => false,
      );
      const baseURL = workerInfo.project.use.baseURL ?? '';
      if (!exists) await registerOwner(browser, baseURL);
      await provide(LEDGER_OWNER_STATE);
    },
    { scope: 'worker' },
  ],
  // Semua konteks bawaan tes memakai sesi pemilik.
  storageState: ({ ownerState }, provide) => provide(ownerState),
});

export { expect, OWNER };
