import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import { MAIL_FILE } from '../../playwright.auth.config';
import { expectNoSeriousViolations, WCAG_TAGS } from '../e2e/axe';

export const PASSWORD = 'kuda-lari-di-sawah-42';

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

/**
 * Pemilik lewat alur nyata (AFD §1): buat akun dari allowlist, konfirmasi email, masuk, amankan
 * dengan passkey (autentikator virtual), kode pemulihan, sampai Beranda. Sesi disimpan sebagai
 * storageState dan dipakai semua tes; worker yang dimulai ulang sesudah tes gagal memakai berkas
 * yang sama (pemilik hanya bisa didaftarkan sekali per run).
 */
export async function registerOwner(
  browser: Browser,
  baseURL: string,
  ownerEmail: string,
  mailFile: string,
  statePath: string,
): Promise<void> {
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await page.goto('/buat-akun');
    await page.getByLabel('Email').fill(ownerEmail);
    await page.getByLabel('Nama panggilan').fill('Novanda');
    await page.getByLabel('Kata sandi baru').fill(PASSWORD);
    await page.getByRole('button', { name: 'Buat akun' }).click();
    await expect(page.getByRole('heading', { name: 'Periksa email' })).toBeVisible();
    await page.goto(linkIn((await lastMail(/Konfirmasi email/, mailFile)).text));
    await page.getByRole('button', { name: 'Konfirmasi email' }).click();
    await expect(page.getByText('Email terkonfirmasi.')).toBeVisible();
    await page.getByLabel('Email').fill(ownerEmail);
    await page.getByLabel('Kata sandi', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page).toHaveURL(/\/amankan$/);
    await addPasskeyAuthenticator(page);
    await page.getByRole('button', { name: 'Buat passkey' }).click();
    await page.getByRole('button', { name: 'Buat kode pemulihan' }).click();
    await page.getByLabel('Saya sudah menyimpan kode ini di tempat yang aman.').check();
    await page.getByRole('button', { name: 'Selesai' }).click();
    await expect(page).toHaveURL(/\/pribadi\/beranda$/);
    await context.storageState({ path: statePath });
  } finally {
    await context.close();
  }
}

/**
 * Helper e2e mode nyata bersama `e2e:auth` dan `e2e:ledger`: email tes, TOTP, autentikator
 * passkey virtual, pemeriksaan layar (axe + tanpa gulir horizontal), dan penyiapan data lewat
 * fungsi `api.*` sebagai dompetku_web (AUTH_E2E_DATABASE_URL) atau superuser (AUTH_E2E_ADMIN_URL).
 */

/** Kosongkan data (superuser) dan pasang owner_email seperti runbook. */
export async function resetData(adminUrl: string, ownerEmail: string): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`
    begin;
    select set_config('dompetku.purge', 'on', true);
    delete from app.product_events;
    delete from app.idempotency_keys;
    delete from app.invitations;
    delete from app.entry_lines;
    delete from app.entry_history;
    delete from app.entries;
    delete from app.entry_tombstones;
    delete from app.bill_occurrences;
    delete from app.bills;
    delete from app.budgets;
    delete from app.accounts;
    delete from app.categories;
    delete from app.no_spend_days;
    delete from app.space_members;
    delete from app.profiles;
    delete from app.spaces;
    delete from app.households;
    delete from audit.events;
    delete from auth."user";
    delete from auth.login_throttle;
    delete from auth.verification;
    commit;`);
    await admin.query(
      `insert into app.settings (key, value) values ('owner_email', $1)
         on conflict (key) do update set value = excluded.value`,
      [ownerEmail],
    );
  } finally {
    await admin.end();
  }
}

/** Email terakhir dengan subjek ini di berkas surat (AUTH_EMAIL_FILE) server e2e. */
export async function lastMail(
  subject: RegExp,
  file: string = MAIL_FILE,
): Promise<{ to: string; text: string }> {
  const lines = (await readFile(file, 'utf8')).trim().split('\n');
  const mails = lines.map((l) => JSON.parse(l) as { to: string; subject: string; text: string });
  const mail = mails.reverse().find((m) => subject.test(m.subject));
  if (!mail) throw new Error(`email ${String(subject)} tidak ada`);
  return mail;
}

export function linkIn(text: string): string {
  const m = /(http:\/\/localhost:\d+\/\S+)/.exec(text);
  if (!m?.[1]) throw new Error('email tanpa tautan');
  return new URL(m[1]).pathname + new URL(m[1]).search;
}

export function totp(secretBase32: string, at = Date.now()): string {
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

export async function addPasskeyAuthenticator(page: Page): Promise<void> {
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

export async function noHorizontalScroll(page: Page): Promise<void> {
  // Sesudah ubah ukuran, tata letak HP/laptop dipilih ulang di klien (useMedia): tunggu stabil.
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
}

export async function checkScreen(page: Page): Promise<void> {
  await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
  await page.setViewportSize({ width: 320, height: 720 });
  await noHorizontalScroll(page);
  await page.setViewportSize({ width: 1280, height: 720 });
}

/** User dan ruang (`personal`/`shared`) milik email ini (superuser, hanya untuk menyiapkan data). */
export async function spaceOf(
  email: string,
  kind: 'personal' | 'shared',
): Promise<{ uid: string; sid: string }> {
  const admin = new pg.Client({ connectionString: process.env.AUTH_E2E_ADMIN_URL });
  try {
    await admin.connect();
    const { rows } = await admin.query<{ uid: string; sid: string }>(
      `select u.id as uid, s.id as sid from auth."user" u
         join app.space_members m on m.user_id = u.id
         join app.spaces s on s.id = m.space_id and s.kind = $2::app.space_kind
        where u.email = $1`,
      [email, kind],
    );
    const row = rows[0];
    if (!row) throw new Error('ruang tidak ada');
    return row;
  } finally {
    await admin.end();
  }
}

/** Satu kueri sebagai dompetku_web dengan konteks user (seperti action ledger). */
export async function asUser<T extends pg.QueryResultRow>(
  uid: string,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const web = new pg.Client({ connectionString: process.env.AUTH_E2E_DATABASE_URL });
  try {
    await web.connect();
    await web.query('begin');
    await web.query("select set_config('app.user_id', $1, true)", [uid]);
    const { rows } = await web.query<T>(sql, params);
    await web.query('commit');
    return rows;
  } finally {
    await web.end();
  }
}

/** Dompet operasional lewat `api.create_account` sebagai dompetku_web (seperti action Dompet). */
export async function createWallet(
  email: string,
  kind: 'personal' | 'shared',
  name: string,
  opening: number,
) {
  const { uid, sid } = await spaceOf(email, kind);
  await asUser(
    uid,
    `select api.create_account(p_client_id => $1, p_space_id => $2, p_name => $3,
       p_pocket => 'operasional', p_wallet_type => 'bank', p_opening_balance => $4::bigint)`,
    [randomUUID(), sid, name, opening],
  );
}

/** Pengeluaran hari ini di dompet bernama `wallet` lewat `api.create_entry` (seperti action Catat). */
export async function createExpense(
  email: string,
  kind: 'personal' | 'shared',
  wallet: string,
  amount: number,
  description: string,
) {
  const { uid, sid } = await spaceOf(email, kind);
  const [ids] = await asUser<{ account: string; category: string }>(
    uid,
    `select (select id from app.accounts where space_id = $1 and name = $2) as account,
            (select id from app.categories
              where space_id = $1 and type = 'expense' and parent_id is null
              order by sort_order limit 1) as category`,
    [sid, wallet],
  );
  if (!ids?.account || !ids.category) throw new Error('dompet/kategori tidak ada');
  await asUser(
    uid,
    `select api.create_entry(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_kind => 'expense', p_amount => $4::bigint, p_category_id => $5, p_description => $6)`,
    [randomUUID(), sid, ids.account, amount, ids.category, description],
  );
}
