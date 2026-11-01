import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { MAIL_FILE } from '../../playwright.auth.config';
import { expectNoSeriousViolations, WCAG_TAGS } from '../e2e/axe';
import { routeScripts } from '../e2e/route-scripts';
import { OWNER } from './global-setup';

/**
 * Alur auth sungguhan ujung ke ujung (AFD §1, §2, §6): pemilik daftar lewat allowlist,
 * konfirmasi email, amankan dengan passkey (autentikator virtual), undang pasangan; pasangan
 * amankan dengan TOTP; masuk lagi, kode salah, jeda, kode pemulihan, lupa kata sandi.
 * Satu urutan serial karena tiap langkah memakai keadaan langkah sebelumnya.
 */

const PARTNER = 'farida@example.test';
const PASSWORD = 'kuda-lari-di-sawah-42';
const NEW_PASSWORD = 'perahu-kertas-di-kali-77';

test.describe.configure({ mode: 'serial' });

async function lastMail(subject: RegExp): Promise<{ to: string; text: string }> {
  const lines = (await readFile(MAIL_FILE, 'utf8')).trim().split('\n');
  const mails = lines.map((l) => JSON.parse(l) as { to: string; subject: string; text: string });
  const mail = mails.reverse().find((m) => subject.test(m.subject));
  if (!mail) throw new Error(`email ${String(subject)} tidak ada`);
  return mail;
}

function linkIn(text: string): string {
  const m = /(http:\/\/localhost:\d+\/\S+)/.exec(text);
  if (!m?.[1]) throw new Error('email tanpa tautan');
  return new URL(m[1]).pathname + new URL(m[1]).search;
}

function totp(secretBase32: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.replace(/\s|=/g, '').toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < key.length; i++) key[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 0xf;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

async function addPasskeyAuthenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function checkScreen(page: Page): Promise<void> {
  await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
  await page.setViewportSize({ width: 320, height: 720 });
  await noHorizontalScroll(page);
  await page.setViewportSize({ width: 1280, height: 720 });
}

let owner: BrowserContext;
let ownerPage: Page;
let partnerPage: Page;
let ownerCodes: string[] = [];
let partnerSecret = '';

test.beforeAll(async ({ browser }) => {
  owner = await browser.newContext();
  ownerPage = await owner.newPage();
  partnerPage = await (await browser.newContext()).newPage();
});

test('halaman data tanpa sesi dialihkan ke /masuk', async () => {
  await ownerPage.goto('/pribadi/beranda');
  await expect(ownerPage).toHaveURL(/\/masuk$/);
  await expect(ownerPage.getByText('Prototipe: belum aktif')).toHaveCount(0);
  await checkScreen(ownerPage);
});

test('JS muat dingin rute auth ≤ 162 kB', async ({ browser }) => {
  for (const path of ['/masuk', '/buat-akun', '/lupa-sandi']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const response = await page.goto(path);
    if (!response) throw new Error('tanpa respons');
    const own = routeScripts(await response.text());
    await page.waitForLoadState('networkidle');
    const bytes = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((e): e is PerformanceResourceTiming => e instanceof PerformanceResourceTiming)
        .filter((e) => new URL(e.name).pathname.endsWith('.js'))
        .map((e) => ({ path: new URL(e.name).pathname, bytes: e.encodedBodySize })),
    );
    await context.close();
    const kB = bytes.filter((s) => own.has(s.path)).reduce((a, s) => a + s.bytes, 0) / 1024;
    test.info().annotations.push({ type: `js-route-kB ${path}`, description: kB.toFixed(1) });
    expect(kB).toBeLessThanOrEqual(162);
  }
});

test('pemilik: daftar lewat allowlist, respons seragam untuk email lain', async () => {
  const page = ownerPage;
  await page.goto('/buat-akun');
  await checkScreen(page);
  await page.getByLabel('Email').fill('orang@example.test');
  await page.getByLabel('Nama panggilan').fill('Orang');
  await page.getByLabel('Kata sandi baru').fill(PASSWORD);
  await page.getByRole('button', { name: 'Buat akun' }).click();
  await expect(page.getByRole('heading', { name: 'Periksa email' })).toBeVisible();

  await page.goto('/buat-akun');
  await page.getByLabel('Email').fill(OWNER);
  await page.getByLabel('Nama panggilan').fill('Novanda');
  await page.getByLabel('Kata sandi baru').fill('pendek');
  await page.getByRole('button', { name: 'Buat akun' }).click();
  await expect(page.getByText('Kata sandi minimal 12 karakter.')).toBeVisible();
  await page.getByLabel('Kata sandi baru').fill(PASSWORD);
  await page.getByRole('button', { name: 'Buat akun' }).click();
  await expect(page.getByRole('heading', { name: 'Periksa email' })).toBeVisible();

  const mail = await lastMail(/Konfirmasi email/);
  expect(mail.to).toBe(OWNER);
  await page.goto(linkIn(mail.text));
  await checkScreen(page);
  await page.getByRole('button', { name: 'Konfirmasi email' }).click();
  await expect(page.getByText('Email terkonfirmasi.')).toBeVisible();
});

test('pemilik: masuk, amankan dengan passkey, kode pemulihan, Beranda', async () => {
  const page = ownerPage;
  await page.getByLabel('Email').fill(OWNER);
  await page.getByLabel('Kata sandi', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page).toHaveURL(/\/amankan$/);
  await expect(page.getByRole('heading', { name: 'Amankan akunmu' })).toBeVisible();
  await checkScreen(page);

  // Halaman data ditolak selama sesi belum punya faktor kuat.
  await page.goto('/pribadi/beranda');
  await expect(page).toHaveURL(/\/amankan$/);

  await addPasskeyAuthenticator(page);
  await page.getByRole('button', { name: 'Buat passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Simpan kode pemulihan' })).toBeVisible();
  await page.getByRole('button', { name: 'Buat kode pemulihan' }).click();
  const codes = page.getByRole('list', { name: 'Kode pemulihan' }).getByRole('listitem');
  await expect(codes).toHaveCount(10);
  ownerCodes = await codes.allInnerTexts();
  await checkScreen(page);
  await expect(page.getByRole('button', { name: 'Selesai' })).toBeDisabled();
  await page.getByLabel('Saya sudah menyimpan kode ini di tempat yang aman.').check();
  await page.getByRole('button', { name: 'Selesai' }).click();
  await expect(page).toHaveURL(/\/pribadi\/beranda$/);
});

test('pemilik: undang pasangan, undangan tertunda', async () => {
  const page = ownerPage;
  await page.goto('/undang');
  await checkScreen(page);
  await page.getByLabel('Email pasangan').fill(PARTNER);
  await page.getByRole('button', { name: 'Kirim undangan' }).click();
  await expect(page.getByText(`Undangan terkirim ke ${PARTNER}.`)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Undangan tertunda' })).toBeVisible();
  await checkScreen(page);
});

test('tautan undangan salah: halaman galat seragam', async () => {
  await partnerPage.goto('/terima-undangan?t=salah');
  await expect(
    partnerPage.getByRole('heading', { name: 'Undangan ini tidak berlaku' }),
  ).toBeVisible();
  await checkScreen(partnerPage);
});

test('pasangan: terima, buat akun, amankan dengan TOTP (kode salah lalu benar)', async () => {
  const page = partnerPage;
  const mail = await lastMail(/mengundangmu/);
  expect(mail.to).toBe(PARTNER);
  await page.goto(linkIn(mail.text));
  await expect(page.getByText(`Undangan untuk ${PARTNER}.`)).toBeVisible();
  await checkScreen(page);
  await page.getByRole('link', { name: 'Terima undangan' }).click();
  await expect(page.getByText(PARTNER)).toBeVisible();
  await checkScreen(page);
  await page.getByLabel('Nama panggilan').fill('Farida');
  await page.getByLabel('Kata sandi baru').fill(PASSWORD);
  await page.getByRole('button', { name: 'Buat akun' }).click();
  await expect(page).toHaveURL(/\/amankan$/);

  await page.getByRole('button', { name: 'Pakai aplikasi autentikator' }).click();
  await page.getByLabel('Kata sandi', { exact: true }).fill('salah-salah-salah');
  await page.getByRole('button', { name: 'Lanjut' }).click();
  await expect(page.getByText('Kata sandi salah.')).toBeVisible();
  await page.getByLabel('Kata sandi', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Lanjut' }).click();
  await expect(
    page.getByRole('img', { name: 'Kode QR untuk aplikasi autentikator' }),
  ).toBeVisible();
  await checkScreen(page);
  partnerSecret = (await page.locator('code').first().innerText()).replace(/\s/g, '');

  await page.getByLabel('Kode 6 angka').fill('000000');
  await page.getByRole('button', { name: 'Verifikasi' }).click();
  await expect(page.getByText('Kode salah.')).toBeVisible();
  await page.getByLabel('Kode 6 angka').fill(totp(partnerSecret));
  await page.getByRole('button', { name: 'Verifikasi' }).click();
  await expect(page.getByRole('heading', { name: 'Simpan kode pemulihan' })).toBeVisible();
  await page.getByRole('button', { name: 'Buat kode pemulihan' }).click();
  await page.getByLabel('Saya sudah menyimpan kode ini di tempat yang aman.').check();
  await page.getByRole('button', { name: 'Selesai' }).click();
  await expect(page).toHaveURL(/\/pribadi\/beranda$/);
});

test('pemilik: ruang Bersama lengkap, undangan diterima', async () => {
  await ownerPage.goto('/undang');
  await expect(ownerPage.getByText('Ruang Bersama sudah berisi dua orang.')).toBeVisible();
  await expect(ownerPage.getByText('Diterima')).toBeVisible();
});

test('pasangan: keluar, masuk lagi dengan kata sandi + TOTP', async () => {
  const page = partnerPage;
  await page.goto('/undang');
  await page.getByRole('button', { name: 'Keluar' }).click();
  await expect(page.getByText('Kamu sudah keluar.')).toBeVisible();
  await page.getByLabel('Email').fill(PARTNER);
  await page.getByLabel('Kata sandi', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Masukkan kode 6 digit' })).toBeVisible();
  await checkScreen(page);
  await page.getByLabel('Kode 6 angka').fill('111111');
  await page.getByRole('button', { name: 'Verifikasi' }).click();
  await expect(page.getByText('Kode salah.')).toBeVisible();
  await page.getByLabel('Kode 6 angka').fill(totp(partnerSecret));
  await page.getByRole('button', { name: 'Verifikasi' }).click();
  await expect(page).toHaveURL(/\/pribadi\/beranda$/);
});

test('pemilik: keluar lalu masuk dengan passkey', async () => {
  const page = ownerPage;
  await page.goto('/undang');
  await page.getByRole('button', { name: 'Keluar' }).click();
  await expect(page).toHaveURL(/\/masuk\?status=keluar$/);
  // Kata sandi saja tidak membuka akun berpasskey.
  await page.getByLabel('Email').fill(OWNER);
  await page.getByLabel('Kata sandi', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByText('Akun ini sudah memakai passkey.')).toBeVisible();
  await page.getByRole('button', { name: 'Masuk dengan passkey' }).click();
  await expect(page).toHaveURL(/\/pribadi\/beranda$/);
});

test('passkey dibatalkan: pesan jelas dan jalur kata sandi', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/masuk');
  // Pengguna menutup dialog passkey: peramban menolak dengan NotAllowedError.
  await page.evaluate(() => {
    navigator.credentials.get = () =>
      Promise.reject(new DOMException('dibatalkan', 'NotAllowedError'));
  });
  await page.getByRole('button', { name: 'Masuk dengan passkey' }).click();
  await expect(page.getByText(/Passkey dibatalkan atau tidak ditemukan/)).toBeVisible();
  await checkScreen(page);
});

test('kode pemulihan: masuk, hanya boleh mendaftar cara masuk baru', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/masuk');
  await page.getByRole('button', { name: 'Pakai kode pemulihan' }).click();
  await checkScreen(page);
  await page.getByLabel('Email').fill(OWNER);
  await page.getByLabel('Kode pemulihan').fill('AAAAA-AAAAA');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByText('Email atau kode pemulihan salah.')).toBeVisible();
  await page.getByLabel('Kode pemulihan').fill(ownerCodes[0] ?? '');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByRole('heading', { name: 'Daftarkan cara masuk baru' })).toBeVisible();
  await page.goto('/pribadi/beranda');
  await expect(page).toHaveURL(/\/amankan$/);
  expect((await lastMail(/pemulihan/)).to).toBe(OWNER);
  // Sesi pemilik lain dicabut.
  await ownerPage.goto('/pribadi/beranda');
  await expect(ownerPage).toHaveURL(/\/masuk/);
});

test('lupa kata sandi: respons seragam, tautan, kata sandi baru', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/masuk');
  await page.getByRole('link', { name: 'Lupa kata sandi?' }).click();
  await expect(page.getByRole('heading', { name: 'Lupa kata sandi' })).toBeVisible();
  await checkScreen(page);
  await page.getByLabel('Email').fill(PARTNER);
  await page.getByRole('button', { name: 'Kirim tautan' }).click();
  await expect(page.getByText(`Kalau ${PARTNER} terdaftar`)).toBeVisible();
  await page.goto(linkIn((await lastMail(/Atur ulang/)).text));
  await checkScreen(page);
  await page.getByLabel('Kata sandi baru').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Simpan kata sandi' }).click();
  await expect(page.getByText('Kata sandi sudah diganti')).toBeVisible();
  // Sesi lama pasangan dicabut.
  await partnerPage.goto('/pribadi/beranda');
  await expect(partnerPage).toHaveURL(/\/masuk/);
  // Masuk lagi tetap butuh TOTP (2FA tidak dimatikan reset).
  await page.getByLabel('Email').fill(PARTNER);
  await page.getByLabel('Kata sandi', { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Masukkan kode 6 digit' })).toBeVisible();
});

// Terakhir: jeda berlaku per IP juga, dan semua request tes datang dari IP yang sama.
test('5 kata sandi salah: jeda dengan waktu tunggu', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/masuk');
  for (let i = 0; i < 5; i++) {
    // Email tak terdaftar: penghitung dan pesannya sama dengan akun yang ada.
    await page.getByLabel('Email').fill('tamu@example.test');
    await page.getByLabel('Kata sandi', { exact: true }).fill(`salah-sekali-${String(i)}-xx`);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    if (i < 4) await expect(page.getByText('Email atau kata sandi salah.')).toBeVisible();
  }
  await expect(page.getByText('Terlalu banyak percobaan. Coba lagi dalam 1 menit.')).toBeVisible();
  await checkScreen(page);
});
