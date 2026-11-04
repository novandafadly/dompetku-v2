import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { asUser, checkScreen, spaceOf } from '../e2e-auth/helpers';
import { expectRouteBudget } from '../e2e-ledger/helpers';
import { expect, test } from './fixtures';
import { OWNER, PARTNER } from './global-setup';

/**
 * Halaman Aktivitas Bersama nyata (S8 Task 7, K5): dua anggota, 35 peristiwa di dua hari WIB,
 * paginasi `?sebelum=` tanpa JS, 404 untuk Pribadi, batas privasi (tanpa nama dompet), tautan baris
 * ke Detail, a11y, dan budget JS rute (Beranda, Transaksi, Aktivitas mode nyata).
 */

const WALLET = 'Kas Aktivitas Uji';
const TOTAL = 35;
const OLD = 20; // peristiwa tertua digeser ke kemarin (WIB) lewat riwayat

async function seedEvents(): Promise<void> {
  const shared = await spaceOf(OWNER, 'shared');
  const f = await spaceOf(PARTNER, 'shared');
  await asUser(
    shared.uid,
    `select api.create_account(p_client_id => $1, p_space_id => $2, p_name => $3,
       p_pocket => 'operasional', p_wallet_type => 'bank', p_opening_balance => 50000000::bigint)`,
    [randomUUID(), shared.sid, WALLET],
  );
  const [acc] = await asUser<{ id: string }>(
    shared.uid,
    'select id::text from app.accounts where space_id = $1 and name = $2',
    [shared.sid, WALLET],
  );
  const [cat] = await asUser<{ id: string }>(
    shared.uid,
    `select id::text from app.categories
      where space_id = $1 and type = 'expense' and parent_id is null order by sort_order limit 1`,
    [shared.sid],
  );
  if (!acc || !cat) throw new Error('dompet atau kategori tidak ada');
  const ids: string[] = [];
  for (let i = 1; i <= TOTAL; i++) {
    const uid = i % 2 === 0 ? f.uid : shared.uid;
    const [r] = await asUser<{ r: { entry_id: string } }>(
      uid,
      `select api.create_entry(p_client_id => $1, p_space_id => $2, p_account_id => $3,
         p_kind => 'expense', p_amount => $4::bigint, p_category_id => $5,
         p_occurred_on => null, p_description => $6) as r`,
      [randomUUID(), shared.sid, acc.id, 1000 * i, cat.id, `Uji aktivitas ${String(i)}`],
    );
    if (!r) throw new Error('create_entry gagal');
    ids.push(r.r.entry_id);
  }
  // Geser riwayat entri tertua ke kemarin (hanya data uji; trigger append-only dilewati superuser).
  const admin = new pg.Client({ connectionString: process.env.AUTH_E2E_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(
      "update app.entry_history set changed_at = changed_at - interval '1 day' where entry_id = any($1::uuid[])",
      [ids.slice(0, OLD)],
    );
    await admin.query('commit');
  } finally {
    await admin.end();
  }
}

test.describe.serial('Aktivitas Bersama nyata', () => {
  test.beforeAll(async ({ kanari }) => {
    expect(kanari.f.wallet).toBeTruthy();
    await seedEvents();
  });

  test('30 baris per halaman, dua hari, Muat sebelumnya lalu Kembali ke terbaru', async ({
    page,
  }) => {
    const response = await page.goto('/bersama/aktivitas?theme=light');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['cache-control']).toContain('no-store');
    await expect(page.getByRole('heading', { name: 'Aktivitas' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Daftar aktivitas' })).toBeAttached();
    const rows = page.getByRole('region').locator('li');
    await expect(rows).toHaveCount(30);
    await expect(page.getByRole('heading', { level: 3, name: 'Hari ini' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Kemarin' })).toBeVisible();
    // Terbaru di atas; keduanya anggota tampil dengan nama.
    await expect(rows.first()).toContainText('Uji aktivitas 35');
    await expect(rows.first()).toContainText('Novanda');
    await expect(rows.nth(1)).toContainText('Farida');
    // Tiap baris menaut ke Detail Bersama, tema ikut terbawa.
    const first = rows.first().getByRole('link');
    await expect(first).toHaveAttribute(
      'href',
      /^\/bersama\/transaksi\/[0-9a-f-]{36}\?theme=light$/,
    );
    // Batas privasi (K1): isi halaman (markup feed, termasuk atribut) tanpa nama dompet atau kanari.
    // Pilihan dompet sheet Catat di shell memang memuat nama dompet ruang ini; itu bukan feed.
    const html = await page.getByRole('main').innerHTML();
    expect(html).not.toContain(WALLET);
    expect(html).not.toContain('KANARI');
    await checkScreen(page);

    const more = page.getByRole('link', { name: 'Muat sebelumnya' });
    await expect(more).toHaveAttribute('href', /^\/bersama\/aktivitas\?theme=light&sebelum=/);
    await more.click();
    await expect(page).toHaveURL(/sebelum=/);
    await expect(rows).toHaveCount(TOTAL - 30);
    await expect(page.getByRole('heading', { level: 3, name: 'Kemarin' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Muat sebelumnya' })).toHaveCount(0);
    await expect(rows.last()).toContainText('Uji aktivitas 1');
    await page.getByRole('link', { name: 'Kembali ke terbaru' }).click();
    await expect(page).toHaveURL(/\/bersama\/aktivitas\?theme=light$/);
    await expect(rows).toHaveCount(30);
  });

  test('kursor rusak = halaman pertama; Pribadi = 404; F melihat halaman yang sama', async ({
    page,
    partnerPage,
  }) => {
    for (const bad of ['rusak!!', 'AAAA', '']) {
      const r = await page.goto(`/bersama/aktivitas?sebelum=${bad}`);
      expect(r?.status()).toBe(200);
      await expect(page.getByRole('region').locator('li')).toHaveCount(30);
      await expect(page.getByRole('link', { name: 'Kembali ke terbaru' })).toHaveCount(0);
    }
    // Status stream sudah 200 saat page melempar notFound (Suspense root); isinya halaman 404.
    await page.goto('/pribadi/aktivitas');
    await expect(page.getByText('This page could not be found.')).toBeVisible();
    await expect(page.getByRole('region').locator('li')).toHaveCount(0);
    await partnerPage.goto('/bersama/aktivitas');
    await expect(partnerPage.getByRole('region').locator('li')).toHaveCount(30);
    expect(await partnerPage.getByRole('main').innerHTML()).not.toContain(WALLET);
    // Beranda -> Semua -> Aktivitas -> Beranda.
    await partnerPage.goto('/bersama/beranda');
    await partnerPage.getByRole('link', { name: /Semua/ }).first().click();
    await expect(partnerPage).toHaveURL(/\/bersama\/aktivitas$/);
    await partnerPage
      .getByRole('link', { name: /Beranda/ })
      .first()
      .click();
    await expect(partnerPage).toHaveURL(/\/bersama\/beranda$/);
  });

  for (const url of ['/bersama/aktivitas', '/bersama/beranda', '/bersama/transaksi']) {
    test(`JS muat dingin ${url} mode nyata ≤ 162 kB`, async ({ browser, ownerState }) => {
      await expectRouteBudget(browser, ownerState, url);
    });
  }
});
