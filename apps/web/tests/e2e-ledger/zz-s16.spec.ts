import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../e2e/axe';
import { asUser, noHorizontalScroll, spaceOf } from '../e2e-auth/helpers';
import { adminQuery, expect, test } from './fixtures';
import { OWNER } from './global-setup';
import { expectRouteBudget } from './helpers';

/**
 * S16 Task 6 mode nyata (e2e:ledger):
 * - Deteksi langganan di Rencana > Tagihan: Jadikan tagihan (isi awal BillSheet) + Abaikan;
 * - Kalender arus kas: proyeksi 30 / 90 hari, tanda Kurang (ikon + teks), catatan jujur (@T14 @T15);
 * - Ekspor PDF di Laporan: header keamanan, escape K9, angka cocok dengan Laporan (@K9);
 * - 320 px bebas gulir horizontal, axe 0 pelanggaran serius, budget JS <= 162 kB.
 */
test.describe.configure({ mode: 'serial' });

const main = (page: Page) => page.getByRole('main');
const WALLET = 'Dompet S16 E2E';
const SUB_PROMOTE = 'Langganan S16 E2E';
const SUB_DISMISS = 'Abaikan S16 E2E';
const BIG_BILL = 'Tagihan Besar S16';
const K9_NOTE = 'Uji K9 ) /JS (1) =cmd';

function wibOffset(days: number): string {
  const ms = Date.now() + 7 * 3_600_000 + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function monthsAgoDay(isoToday: string, back: number, day: number): string {
  const [y, m] = isoToday.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 - back, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

test('Deteksi langganan: Jadikan tagihan (prefill BillSheet) dan Abaikan permanen @T14', async ({
  page,
}) => {
  const { uid, sid } = await spaceOf(OWNER, 'personal');
  const today = wibOffset(0);
  const opened = monthsAgoDay(today, 3, 1);

  const [accRow] = await asUser<{ r: { account_id: string } }>(
    uid,
    `select api.create_account($1, $2, $3, 'operasional', 'bank', $4::date, 2000000) as r`,
    [randomUUID(), sid, WALLET, opened],
  );
  const accId = accRow?.r.account_id;
  expect(accId).toBeTruthy();

  const [catRow] = await adminQuery<{ id: string }>(
    `select id from app.categories where space_id = $1 and type = 'expense' and parent_id is null and archived_at is null order by sort_order limit 1`,
    [sid],
  );
  const catId = catRow?.id;
  expect(catId).toBeTruthy();

  // 3 bulan berbeda untuk dua kandidat langganan (75.000 & 49.000).
  for (const [desc, amt] of [
    [SUB_PROMOTE, 75_000],
    [SUB_DISMISS, 49_000],
  ] as const) {
    for (const back of [2, 1, 0]) {
      const dt = back === 0 ? today : monthsAgoDay(today, back, 10);
      await asUser(
        uid,
        `select api.create_entry($1, $2, $3, 'expense', $4::bigint, $5, $6::date, $7)`,
        [randomUUID(), sid, accId, amt, catId, dt, desc],
      );
    }
  }

  await page.goto('/pribadi/rencana?bagian=tagihan');
  await expect(main(page).getByText('Saran langganan')).toBeVisible();
  await expect(main(page).getByText(SUB_PROMOTE)).toBeVisible();
  await expect(main(page).getByText(SUB_DISMISS)).toBeVisible();
  await expect(main(page).getByRole('link', { name: 'Lihat kalender arus kas' })).toBeVisible();

  // Jadikan tagihan: klik dengan ulang hidrasi pulau malas sampai dialog terbuka.
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await main(page)
        .getByRole('button', { name: `Jadikan tagihan ${SUB_PROMOTE}` })
        .click();
    }
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await expect(dialog.getByLabel('Nama')).toHaveValue(SUB_PROMOTE);
  await expect(dialog.getByLabel(/Perkiraan/i)).toHaveValue('75.000');
  await dialog.getByRole('button', { name: 'Simpan' }).click();
  await expect(dialog).toBeHidden();
  // Sudah jadi tagihan aktif -> hilang dari Saran langganan.
  await expect(
    main(page).getByRole('button', { name: `Jadikan tagihan ${SUB_PROMOTE}` }),
  ).toHaveCount(0);

  // Abaikan saran kedua -> hilang dan tetap hilang sesudah muat ulang.
  await expect(async () => {
    const btn = main(page).getByRole('button', { name: `Abaikan ${SUB_DISMISS}` });
    if ((await btn.count()) > 0) await btn.click();
    await expect(btn).toHaveCount(0, { timeout: 2_000 });
  }).toPass();
  await page.reload();
  await expect(main(page).getByRole('button', { name: `Abaikan ${SUB_DISMISS}` })).toHaveCount(0);
});

test('Kalender arus kas: jendela 30 & 90 hari, status Kurang, dan proyeksi @T14 @T15', async ({
  page,
}) => {
  const { uid, sid } = await spaceOf(OWNER, 'personal');
  const today = wibOffset(0);
  const due2 = wibOffset(2);
  const dueDay = Number(due2.slice(8, 10));

  // Hitung saldo operasional aktual agar tagihan besar pasti membuat proyeksi Kurang.
  const [opsRow] = await asUser<{ ops: string }>(
    uid,
    `select operasional::text as ops from api.safe_to_spend($1)`,
    [sid],
  );
  const ops = Number(opsRow?.ops ?? '0');
  const bigAmt = Math.max(ops, 0) + 500_000;

  const [catRow] = await adminQuery<{ id: string }>(
    `select id from app.categories where space_id = $1 and type = 'expense' and parent_id is null and archived_at is null order by sort_order limit 1`,
    [sid],
  );
  const [accRow] = await adminQuery<{ id: string }>(
    `select id from app.accounts where space_id = $1 and name = $2 limit 1`,
    [sid, WALLET],
  );
  await asUser(
    uid,
    `select api.create_bill($1, $2, $3, $4::bigint, $5, $6::smallint, $7::date, null, $8)`,
    [randomUUID(), sid, BIG_BILL, bigAmt, catRow?.id, dueDay, today, accRow?.id],
  );

  await page.goto('/pribadi/rencana?bagian=tagihan');
  await main(page).getByRole('link', { name: 'Lihat kalender arus kas' }).click();
  await expect(page).toHaveURL(/\/pribadi\/rencana\/kalender/);
  await expect(main(page).getByText(/Pemasukan belum diproyeksikan/)).toBeVisible();
  await expect(main(page).getByText(BIG_BILL).first()).toBeVisible();
  await expect(main(page).getByRole('status')).toContainText('Saldo diperkirakan kurang mulai');
  await expect(main(page).getByText('Kurang').first()).toBeVisible();

  // Pindah ke jendela 90 hari -> memunculkan proyeksi bulan depan.
  await main(page).getByRole('link', { name: '90 hari' }).click();
  await expect(page).toHaveURL(/hari=90/);
  await expect(main(page).getByRole('link', { name: '90 hari' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(main(page).getByText('Perkiraan').first()).toBeVisible();
});

test('Ekspor PDF di Laporan: header keamanan, isi cocok, dan escape penuh @K9', async ({
  page,
}) => {
  const { uid, sid } = await spaceOf(OWNER, 'personal');
  const today = wibOffset(0);
  const [accRow] = await adminQuery<{ id: string }>(
    `select id from app.accounts where space_id = $1 and name = $2 limit 1`,
    [sid, WALLET],
  );
  const [catRow] = await adminQuery<{ id: string }>(
    `select id from app.categories where space_id = $1 and type = 'expense' and parent_id is null and archived_at is null order by sort_order limit 1`,
    [sid],
  );
  await asUser(uid, `select api.create_entry($1, $2, $3, 'expense', 43210, $4, $5::date, $6)`, [
    randomUUID(),
    sid,
    accRow?.id,
    catRow?.id,
    today,
    K9_NOTE,
  ]);

  await page.goto('/pribadi/laporan');
  const pdfLink = main(page).getByRole('link', { name: 'Ekspor PDF' });
  await expect(pdfLink).toBeVisible();
  await expect(main(page).getByRole('link', { name: 'Ekspor CSV' })).toBeVisible();

  const href = await pdfLink.getAttribute('href');
  expect(href).toMatch(/^\/pribadi\/laporan\/ekspor-pdf\?/);
  const res = await page.request.get(href ?? '/pribadi/laporan/ekspor-pdf');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/pdf');
  expect(res.headers()['cache-control']).toBe('no-store');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  expect(res.headers()['content-disposition']).toMatch(
    /^attachment; filename="dompetku-pribadi-\d{4}-\d{2}/,
  );
  const body = (await res.body()).toString('latin1');
  expect(body.startsWith('%PDF-1.4\n')).toBe(true);
  expect(body.endsWith('%%EOF\n')).toBe(true);
  expect(body).toContain('43.210');
  expect(body).toContain('Uji K9 \\) /JS \\(1\\) =cmd');
  expect(body).not.toMatch(/\/Type\s+\/Annot/);
});

test('320 px tanpa gulir horizontal, axe bersih, dan budget JS <= 162 kB', async ({
  page,
  browser,
  ownerState,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const url of [
    '/pribadi/rencana/kalender',
    '/pribadi/rencana/kalender?hari=90',
    '/pribadi/laporan',
  ]) {
    await page.goto(url);
    await expect(main(page)).toBeVisible();
    await noHorizontalScroll(page);
    await expectNoSeriousViolations(page);
  }
  await expectRouteBudget(browser, ownerState, '/pribadi/rencana/kalender');
  await expectRouteBudget(browser, ownerState, '/pribadi/laporan');
});
