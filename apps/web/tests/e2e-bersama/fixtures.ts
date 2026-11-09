import { access } from 'node:fs/promises';
import { test as base, expect, type Browser, type Page } from '@playwright/test';
import {
  BERSAMA_MAIL_FILE,
  BERSAMA_OWNER_STATE,
  BERSAMA_PARTNER_STATE,
} from '../../playwright.bersama.config';
import {
  adminQuery,
  createExpense,
  createWallet,
  lastMail,
  linkIn,
  PASSWORD,
  registerOwner,
  spaceOf,
  totp,
} from '../e2e-auth/helpers';
import { OWNER, PARTNER } from './global-setup';

/** Data kanari Pribadi (nominal berbeda per orang agar bocor lintas ruang mudah terlihat). */
export const KANARI = {
  n: {
    email: OWNER,
    wallet: 'KANARI-DOMPET-N',
    description: 'KANARI-N-PRIBADI',
    amount: 7_777_777,
  },
  f: {
    email: PARTNER,
    wallet: 'KANARI-DOMPET-F',
    description: 'KANARI-F-PRIBADI',
    amount: 6_666_666,
  },
} as const;
export type Kanari = typeof KANARI;

/**
 * Isi Pribadi satu orang; idempoten karena worker dimulai ulang sesudah tes gagal dan nama dompet
 * unik per ruang (createWallet kedua kali akan melempar): cek dulu dompet dan entri yang ada.
 */
export async function seedKanari(k: Kanari['n'] | Kanari['f']): Promise<void> {
  const { sid } = await spaceOf(k.email, 'personal');
  const [wallet] = await adminQuery(
    'select 1 from app.accounts where space_id = $1 and name = $2',
    [sid, k.wallet],
  );
  if (!wallet) await createWallet(k.email, 'personal', k.wallet, 20_000_000);
  const [entry] = await adminQuery(
    'select 1 from app.entries where space_id = $1 and description = $2',
    [sid, k.description],
  );
  if (!entry) await createExpense(k.email, 'personal', k.wallet, k.amount, k.description);
}

const EMPTY_STATE = { cookies: [], origins: [] };

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

/** N mengundang F lewat /undang. */
async function invitePartner(ownerPage: Page): Promise<void> {
  await ownerPage.goto('/undang');
  await ownerPage.getByLabel('Email pasangan').fill(PARTNER);
  await ownerPage.getByRole('button', { name: 'Kirim undangan' }).click();
  await expect(ownerPage.getByText(`Undangan terkirim ke ${PARTNER}.`)).toBeVisible();
}

/** F membuka tautan dari mail file: Terima, Buat akun (Farida), TOTP, kode pemulihan, Beranda. */
async function registerPartner(
  browser: Browser,
  baseURL: string,
  ownerState: string,
): Promise<void> {
  const ownerContext = await browser.newContext({ baseURL, storageState: ownerState });
  try {
    await invitePartner(await ownerContext.newPage());
  } finally {
    await ownerContext.close();
  }
  // Konteks bersih: tanpa storageState eksplisit, browser.newContext mewarisi sesi N dari fixture.
  const context = await browser.newContext({ baseURL, storageState: EMPTY_STATE });
  try {
    const page = await context.newPage();
    const mail = await lastMail(/mengundangmu/, BERSAMA_MAIL_FILE);
    expect(mail.to).toBe(PARTNER);
    await page.goto(linkIn(mail.text));
    await expect(page.getByText(`Undangan untuk ${PARTNER}.`)).toBeVisible();
    await page.getByRole('link', { name: 'Terima undangan' }).click();
    await expect(page.getByText(PARTNER)).toBeVisible();
    await page.getByLabel('Nama panggilan').fill('Farida');
    await page.getByLabel('Kata sandi baru').fill(PASSWORD);
    await page.getByRole('button', { name: 'Buat akun' }).click();
    await expect(page).toHaveURL(/\/amankan$/);
    await page.getByRole('button', { name: 'Pakai aplikasi autentikator' }).click();
    await page.getByLabel('Kata sandi', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Lanjut' }).click();
    await expect(
      page.getByRole('img', { name: 'Kode QR untuk aplikasi autentikator' }),
    ).toBeVisible();
    const secret = (await page.locator('code').first().innerText()).replace(/\s/g, '');
    await page.getByLabel('Kode 6 angka').fill(totp(secret));
    await page.getByRole('button', { name: 'Verifikasi' }).click();
    await expect(page.getByRole('heading', { name: 'Simpan kode pemulihan' })).toBeVisible();
    await page.getByRole('button', { name: 'Buat kode pemulihan' }).click();
    await page.getByLabel('Saya sudah menyimpan kode ini di tempat yang aman.').check();
    await page.getByRole('button', { name: 'Selesai' }).click();
    await expect(page).toHaveURL(/\/pribadi\/beranda$/);
    await context.storageState({ path: BERSAMA_PARTNER_STATE });
  } finally {
    await context.close();
  }
}

export const test = base.extend<
  { partnerPage: Page },
  { ownerState: string; partnerState: string; kanari: Kanari }
>({
  ownerState: [
    async ({ browser }, provide, workerInfo) => {
      const baseURL = workerInfo.project.use.baseURL ?? '';
      if (!(await exists(BERSAMA_OWNER_STATE)))
        await registerOwner(browser, baseURL, OWNER, BERSAMA_MAIL_FILE, BERSAMA_OWNER_STATE);
      await provide(BERSAMA_OWNER_STATE);
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  // Pendaftaran sekali per run; worker yang dimulai ulang memakai berkas yang sama.
  partnerState: [
    async ({ browser, ownerState }, provide, workerInfo) => {
      const baseURL = workerInfo.project.use.baseURL ?? '';
      if (!(await exists(BERSAMA_PARTNER_STATE))) {
        await registerPartner(browser, baseURL, ownerState);
      }
      await provide(BERSAMA_PARTNER_STATE);
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  // Pribadi N dan F diisi sekali lewat fungsi api.* (asUser), bukan UI: lebih cepat dan stabil.
  kanari: [
    async ({ partnerState }, provide) => {
      if (!partnerState) throw new Error('F belum terdaftar');
      for (const k of [KANARI.n, KANARI.f]) await seedKanari(k);
      await provide(KANARI);
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  // Semua konteks bawaan tes memakai sesi N; F lewat fixture `partnerPage`.
  storageState: ({ ownerState }, provide) => provide(ownerState),
  partnerPage: async ({ browser, partnerState }, provide, testInfo) => {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL ?? '',
      storageState: partnerState,
    });
    await provide(await context.newPage());
    await context.close();
  },
});

export { expect };
