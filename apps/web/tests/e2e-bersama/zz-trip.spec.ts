import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../e2e/axe';
import { asUser, createWallet, noHorizontalScroll, spaceOf } from '../e2e-auth/helpers';
import { adminQuery } from '../e2e-ledger/fixtures';
import {
  bersamaResponses,
  catatSheet,
  digits,
  expectRouteBudget,
  openCatat,
  toasts,
} from '../e2e-ledger/helpers';
import { expect, test } from './fixtures';
import { OWNER } from './global-setup';

/**
 * S15 Task 11 Bersama (dua user: Novanda & Farida):
 * - trip Bersama dibuat Novanda, terlihat dan bisa diubah/dipakai Farida (K1);
 * - Bagi tagihan (patungan) ke trip Bersama menaikkan total dan `Dicatat oleh`, baris patungan
 *   tanpa tombol `Keluarkan` (K6);
 * - feed Aktivitas Farida tidak banjir oleh tag-saja (K16);
 * - kanari nama trip Pribadi Novanda tidak ada di HTML/RSC pasangan maupun rute Bersama (@B25);
 * - 320 px, axe, dan budget JS.
 */
test.describe.configure({ mode: 'serial' });

const main = (page: Page) => page.getByRole('main');
const WALLET_B = 'Kas Trip Bersama E2E';
const TRIP_B = 'Lombok Berdua E2E';
const TRIP_B_EDIT = 'Lombok Berdua Edit';
const CANARY_TRIP = 'KANARI-TRIP-PRIBADI-N';
const rp = (n: number) => `Rp ${digits(n)}`;

function offsetDate(days: number): string {
  const nowWib = Date.now() + 7 * 3_600_000 + days * 86_400_000;
  return new Date(nowWib).toISOString().slice(0, 10);
}

const STARTS = offsetDate(-1);
const ENDS = offsetDate(5);

let sharedTripHref = '';

test('Novanda membuat trip Bersama dan kanari Pribadi; Farida melihat dan mengubah trip Bersama (K1)', async ({
  page,
  partnerPage,
  kanari,
}) => {
  expect(kanari.f.wallet).toBeTruthy();
  // Pastikan ada dompet operasional Bersama agar tes bisa jalan berdiri sendiri maupun setelah spec lain.
  const bersama = await spaceOf(OWNER, 'shared');
  const [haveWallet] = await adminQuery(
    `select 1 from app.accounts where space_id = $1 and pocket = 'operasional' and archived_at is null limit 1`,
    [bersama.sid],
  );
  if (!haveWallet) await createWallet(OWNER, 'shared', WALLET_B, 5_000_000);

  // Buat trip kanari Pribadi N lewat SQL (tidak menyentuh UI Pribadi).
  const nPribadi = await spaceOf(OWNER, 'personal');
  const [have] = await adminQuery('select 1 from app.trips where space_id = $1 and name = $2', [
    nPribadi.sid,
    CANARY_TRIP,
  ]);
  if (!have) {
    await asUser(
      nPribadi.uid,
      `select api.create_trip(p_client_id => $1, p_space_id => $2, p_name => $3,
         p_starts_on => $4::date, p_ends_on => $5::date, p_budget_amount => null)`,
      [randomUUID(), nPribadi.sid, CANARY_TRIP, STARTS, ENDS],
    );
  }

  await page.goto('/bersama/trip');
  await expect(main(page).getByRole('heading', { level: 1, name: 'Trip · Bersama' })).toBeVisible();
  const sheet = page.getByRole('dialog', { name: /^Tambah trip/ });
  await expect(async () => {
    if ((await sheet.count()) === 0) {
      await main(page).getByRole('button', { name: 'Tambah trip' }).first().click();
    }
    await expect(sheet.getByRole('textbox', { name: 'Nama trip' })).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await sheet.getByRole('textbox', { name: 'Nama trip' }).fill(TRIP_B);
  await sheet.getByLabel('Mulai').fill(STARTS);
  await sheet.getByLabel('Selesai').fill(ENDS);
  await sheet.getByRole('textbox', { name: /Anggaran trip/ }).fill('1000000');
  await sheet.getByRole('button', { name: 'Simpan trip' }).click();
  await expect(toasts(page).getByText(`Trip ${TRIP_B} dibuat di Bersama`)).toBeVisible();

  const row = main(page).getByRole('link', { name: new RegExp(TRIP_B) });
  await expect(row).toBeVisible();
  sharedTripHref = (await row.getAttribute('href')) ?? '';
  expect(sharedTripHref).toMatch(/^\/bersama\/trip\/[0-9a-f-]+$/);

  // Farida membuka Detail trip Bersama dan mengubah namanya (K1).
  await partnerPage.goto(sharedTripHref);
  await expect(main(partnerPage).getByRole('heading', { level: 1, name: TRIP_B })).toBeVisible();
  const editSheet = partnerPage.getByRole('dialog', { name: /^Ubah trip/ });
  await expect(async () => {
    if ((await editSheet.count()) === 0) {
      await main(partnerPage).getByRole('button', { name: 'Ubah trip' }).click();
    }
    await expect(editSheet.getByRole('textbox', { name: 'Nama trip' })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  await editSheet.getByRole('textbox', { name: 'Nama trip' }).fill(TRIP_B_EDIT);
  await editSheet.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(
    toasts(partnerPage).getByText(`Trip ${TRIP_B_EDIT} diperbarui di Bersama`),
  ).toBeVisible();
  await expect(
    main(partnerPage).getByRole('heading', { level: 1, name: TRIP_B_EDIT }),
  ).toBeVisible();
});

test('Bagi tagihan ke trip Bersama (K6) menaikkan total & Dicatat oleh; feed Aktivitas tidak banjir (K16)', async ({
  page,
  partnerPage,
}) => {
  // Catat pengeluaran Bersama oleh Farida (tanpa trip dulu), lalu cek feed sebelum/sesudah Masukkan.
  await partnerPage.goto('/bersama/beranda');
  await openCatat(partnerPage);
  const fSheet = catatSheet(partnerPage);
  await fSheet.getByRole('button', { name: `Lepas dari trip ${TRIP_B_EDIT}` }).click();
  await fSheet.getByRole('textbox', { name: 'Nominal' }).fill('150000');
  await fSheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio').first().click();
  await fSheet.getByLabel(/Keterangan/).fill('Snorkeling F');
  await fSheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(partnerPage)
      .getByText(/Tersimpan di Bersama/)
      .last(),
  ).toBeVisible();
  await expect(catatSheet(partnerPage)).toHaveCount(0);

  await partnerPage.goto('/bersama/aktivitas');
  const feedBefore = await main(partnerPage).getByRole('listitem').count();

  // Masukkan pengeluaran Farida ke trip (tag-saja → tidak menambah baris feed K16).
  await page.goto(sharedTripHref);
  const imp = page.getByRole('dialog', { name: new RegExp(`Masukkan ke ${TRIP_B_EDIT}`) });
  await expect(async () => {
    if ((await imp.count()) === 0) {
      await main(page)
        .getByRole('button', { name: /Masukkan 1 pengeluaran/ })
        .click();
    }
    await expect(imp.getByRole('button', { name: 'Masukkan 1 pengeluaran' })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  await imp.getByRole('button', { name: 'Masukkan 1 pengeluaran' }).click();
  await expect(toasts(page).getByText(`1 pengeluaran dimasukkan ke ${TRIP_B_EDIT}`)).toBeVisible();

  await partnerPage.goto('/bersama/aktivitas');
  expect(await main(partnerPage).getByRole('listitem').count()).toBe(feedBefore);

  // Novanda mencatat patungan (Bagi tagihan) ke trip Bersama (K6).
  await page.goto('/bersama/beranda');
  await openCatat(page);
  const nSheet = catatSheet(page);
  await expect(nSheet.getByRole('button', { name: `Trip ${TRIP_B_EDIT}, ganti` })).toBeVisible();
  await nSheet.getByRole('switch', { name: /Dibayar dari dompet pribadi/ }).click();
  await expect(
    nSheet.getByText(
      'Trip tidak bisa diubah sesudah tagihan dibagi. Batalkan tagihan di Patungan bila salah.',
    ),
  ).toBeVisible();
  await nSheet.getByRole('textbox', { name: 'Nominal' }).fill('200000');
  await nSheet.getByRole('radiogroup', { name: 'Kategori' }).getByRole('radio').first().click();
  await nSheet.getByLabel(/Keterangan/).fill('Makan patungan N');
  await nSheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page)
      .getByText(/Patungan dicatat di Bersama/)
      .last(),
  ).toBeVisible();
  await expect(catatSheet(page)).toHaveCount(0);

  // Detail trip: total 350.000, Dicatat oleh menampilkan kedua anggota, baris patungan tanpa Keluarkan.
  await page.goto(sharedTripHref);
  await expect(main(page).getByTestId('trip-total')).toContainText(rp(350_000));
  await expect(main(page)).toContainText('Dicatat oleh');
  await expect(main(page)).toContainText('Kamu');
  await expect(main(page)).toContainText('Farida');
  await expect(main(page)).toContainText('Dari patungan');
  await expect(main(page).getByRole('button', { name: /Makan patungan N/ })).toHaveCount(0);
  await expect(
    main(page).getByRole('button', { name: 'Keluarkan dari trip: Snorkeling F' }),
  ).toBeVisible();
});

test(
  'kanari trip Pribadi N tidak ada di HTML/RSC pasangan maupun rute Bersama',
  { tag: ['@B25'] },
  async ({ page, partnerPage }) => {
    const checks: [string, Page, string[]][] = [
      ['F', partnerPage, ['/bersama/trip', sharedTripHref, '/pribadi/trip']],
      ['N', page, ['/bersama/trip', sharedTripHref]],
    ];
    for (const [who, p, urls] of checks) {
      for (const url of urls) {
        const doc = await bersamaResponses(p, () => p.goto(url));
        expect(doc.unread, `${who} ${url}`).toEqual([]);
        const rsc = await p.evaluate(async (u) => {
          const r = await fetch(`${u}${u.includes('?') ? '&' : '?'}_rsc`, {
            headers: { RSC: '1' },
            redirect: 'manual',
          });
          return { status: r.status, body: await r.text() };
        }, url);
        expect(rsc.status, `${who} RSC ${url}`).toBe(200);
        const html = await p.content();
        for (const body of [...doc.bodies, html, rsc.body]) {
          expect(body.includes(CANARY_TRIP), `${who} ${url}`).toBe(false);
        }
      }
    }
  },
);

test('320 px tanpa gulir horizontal, axe bersih, dan budget JS Bersama', async ({
  page,
  browser,
  ownerState,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const url of ['/bersama/trip', sharedTripHref]) {
    await page.goto(url);
    await expect(main(page).getByRole('heading', { level: 1 })).toBeVisible();
    await noHorizontalScroll(page);
    await expectNoSeriousViolations(page);
  }
  await expectRouteBudget(browser, ownerState, '/bersama/trip');
  await expectRouteBudget(browser, ownerState, sharedTripHref);
});
