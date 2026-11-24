import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../e2e/axe';
import { asUser, noHorizontalScroll, spaceOf } from '../e2e-auth/helpers';
import { adminQuery } from '../e2e-ledger/fixtures';
import { bersamaResponses, expectRouteBudget } from '../e2e-ledger/helpers';
import { expect, test } from './fixtures';
import { OWNER } from './global-setup';

/**
 * S16 Task 6 Bersama (@B13):
 * - Kalender arus kas Bersama, saran langganan Bersama, dan Ekspor PDF Bersama oleh Farida
 *   tidak pernah memuat kanari tagihan, langganan, atau catatan Pribadi Novanda;
 * - 320 px tanpa gulir horizontal, axe bersih, dan budget JS <= 162 kB.
 */
test.describe.configure({ mode: 'serial' });

const main = (page: Page) => page.getByRole('main');
const CANARY_SUB = 'KANARI-LANGGANAN-S16';
const CANARY_BILL = 'KANARI-KALENDER-S16';
const CANARY_PDF = 'KANARI-PDF-S16 ) /JS (x)';

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

test('Isolasi Bersama: Kalender, Saran langganan, dan Ekspor PDF Farida tanpa kanari Pribadi Novanda @B13 @K9', async ({
  partnerPage,
  kanari,
}) => {
  expect(kanari.f.wallet).toBeTruthy();
  const pribadiN = await spaceOf(OWNER, 'personal');
  const today = wibOffset(0);
  const opened = monthsAgoDay(today, 3, 1);

  const [accRow] = await asUser<{ r: { account_id: string } }>(
    pribadiN.uid,
    `select api.create_account($1, $2, 'Dompet Kanari S16', 'operasional', 'bank', $3::date, 5000000) as r`,
    [randomUUID(), pribadiN.sid, opened],
  );
  const accId = accRow?.r.account_id;
  expect(accId).toBeTruthy();

  const [catRow] = await adminQuery<{ id: string }>(
    `select id from app.categories where space_id = $1 and type = 'expense' and parent_id is null and archived_at is null order by sort_order limit 1`,
    [pribadiN.sid],
  );
  const catId = catRow?.id;
  expect(catId).toBeTruthy();

  // 3 bulan pengeluaran berulang kanari di Pribadi N.
  for (const back of [2, 1, 0]) {
    const dt = back === 0 ? today : monthsAgoDay(today, back, 8);
    await asUser(
      pribadiN.uid,
      `select api.create_entry($1, $2, $3, 'expense', 66666, $4, $5::date, $6)`,
      [randomUUID(), pribadiN.sid, accId, catId, dt, CANARY_SUB],
    );
  }
  // Catatan kanari PDF hari ini di Pribadi N.
  await asUser(
    pribadiN.uid,
    `select api.create_entry($1, $2, $3, 'expense', 77777, $4, $5::date, $6)`,
    [randomUUID(), pribadiN.sid, accId, catId, today, CANARY_PDF],
  );
  // Tagihan kanari di Pribadi N.
  await asUser(
    pribadiN.uid,
    `select api.create_bill($1, $2, $3, 9876543::bigint, $4, 15::smallint, $5::date, null, $6)`,
    [randomUUID(), pribadiN.sid, CANARY_BILL, catId, today, accId],
  );

  // Periksa HTML & RSC Bersama pada Farida: bebas kanari Pribadi N.
  for (const url of ['/bersama/rencana?bagian=tagihan', '/bersama/rencana/kalender?hari=90']) {
    const doc = await bersamaResponses(partnerPage, async () => {
      await partnerPage.goto(url);
      await expect(main(partnerPage)).toBeVisible();
    });
    const rsc = await partnerPage.evaluate(async (u: string) => {
      const r = await fetch(u, { headers: { RSC: '1' }, credentials: 'same-origin' });
      return { status: r.status, body: await r.text() };
    }, url);
    expect(rsc.status, `Farida RSC ${url}`).toBe(200);
    const html = await partnerPage.content();
    for (const body of [...doc.bodies, html, rsc.body]) {
      expect(body.includes(CANARY_SUB), `SUB ${url}`).toBe(false);
      expect(body.includes(CANARY_BILL), `BILL ${url}`).toBe(false);
      expect(body.includes('9.876.543'), `AMT ${url}`).toBe(false);
    }
  }

  // Ekspor PDF Bersama oleh Farida: sah dan bebas kanari Pribadi N.
  await partnerPage.goto('/bersama/laporan');
  const pdfLink = main(partnerPage).getByRole('link', { name: 'Ekspor PDF' });
  await expect(pdfLink).toBeVisible();
  const href = await pdfLink.getAttribute('href');
  expect(href).toMatch(/^\/bersama\/laporan\/ekspor-pdf\?/);
  const res = await partnerPage.request.get(href ?? '/bersama/laporan/ekspor-pdf');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/pdf');
  expect(res.headers()['cache-control']).toBe('no-store');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  const pdfText = (await res.body()).toString('latin1');
  expect(pdfText.startsWith('%PDF-1.4\n')).toBe(true);
  expect(pdfText).not.toContain('KANARI-PDF-S16');
  expect(pdfText).not.toContain(CANARY_SUB);
  expect(pdfText).not.toContain('77.777');
  expect(pdfText).not.toContain('66.666');
});

test('320 px tanpa gulir horizontal, axe bersih, dan budget JS Kalender Bersama', async ({
  partnerPage,
  browser,
  partnerState,
}) => {
  await partnerPage.setViewportSize({ width: 320, height: 640 });
  await partnerPage.goto('/bersama/rencana/kalender');
  await expect(main(partnerPage)).toBeVisible();
  await noHorizontalScroll(partnerPage);
  await expectNoSeriousViolations(partnerPage);
  await expectRouteBudget(browser, partnerState, '/bersama/rencana/kalender');
});
