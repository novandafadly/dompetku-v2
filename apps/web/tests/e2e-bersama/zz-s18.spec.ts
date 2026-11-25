import { randomUUID } from 'node:crypto';
import { expectNoSeriousViolations } from '../e2e/axe';
import { asUser, noHorizontalScroll, spaceOf } from '../e2e-auth/helpers';
import { expectRouteBudget } from '../e2e-ledger/helpers';
import { expect, test } from './fixtures';
import { OWNER } from './global-setup';

/**
 * S18 Bersama (@B13):
 * - `/bersama/analisis` milik Farida tidak pernah menampilkan kategori/nominal kanari Pribadi Novanda;
 * - Farida tidak bisa mengunduh atau menghapus foto struk yang diunggah Novanda di ruang Pribadi;
 * - 320 px bebas gulir horizontal, axe 0 pelanggaran serius, budget JS <= 162 kB.
 */
test.describe.configure({ mode: 'serial' });

const CANARY_CAT = 'KanariAnalisisPribadiS18';
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function wibToday(): string {
  const ms = Date.now() + 7 * 3_600_000;
  return new Date(ms).toISOString().slice(0, 10);
}

test('Isolasi Bersama: Analisis AI dan Foto struk Pribadi tidak pernah bocor ke pasangan @B13', async ({
  page,
  partnerPage,
  browser,
  partnerState,
}) => {
  const pribadiN = await spaceOf(OWNER, 'personal');
  const today = wibToday();

  const [accRow] = await asUser<{ r: { account_id: string } }>(
    pribadiN.uid,
    `select api.create_account($1, $2, 'BCA Kanari S18', 'operasional', 'bank', $3::date, 5000000) as r`,
    [randomUUID(), pribadiN.sid, today],
  );
  const [catRow] = await asUser<{ r: { category_id: string } }>(
    pribadiN.uid,
    `select api.create_category($1, $2, 'expense', $3, 'Tag', null) as r`,
    [randomUUID(), pribadiN.sid, CANARY_CAT],
  );
  const [entryRow] = await asUser<{ r: { entry_id: string } }>(
    pribadiN.uid,
    `select api.create_entry(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_kind => 'expense', p_amount => 777000, p_category_id => $4, p_description => 'Rahasia Pribadi S18') as r`,
    [randomUUID(), pribadiN.sid, accRow?.r.account_id, catRow?.r.category_id],
  );
  const entryId = entryRow?.r.entry_id;
  expect(entryId).toBeTruthy();

  // Novanda mengunggah foto struk di ruang Pribadi.
  await page.goto(`/pribadi/transaksi/${entryId ?? ''}`);
  const section = page.getByRole('region', { name: 'Foto struk' });
  await section.locator('input[type="file"]').setInputFiles({
    name: 'rahasia.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  });
  await expect(section).toContainText('1 dari 3');
  const attHref = await section
    .getByRole('link', { name: 'Struk 1', exact: true })
    .getAttribute('href');
  expect(attHref).toBeTruthy();

  // Farida mencoba mengakses URL foto struk Pribadi Novanda (baik /pribadi maupun /bersama) → 404.
  const crossPribadi = await partnerPage.request.get(attHref ?? '');
  expect(crossPribadi.status()).toBe(404);
  const crossBersama = await partnerPage.request.get(
    (attHref ?? '').replace('/pribadi/', '/bersama/'),
  );
  expect(crossBersama.status()).toBe(404);
  const crossDelete = await partnerPage.request.delete(attHref ?? '');
  expect(crossDelete.status()).toBe(404);

  // Farida membuka /bersama/analisis → 0 kanari Pribadi Novanda, bebas gulir, axe bersih, budget OK.
  await expectRouteBudget(browser, partnerState, '/bersama/analisis');
  await partnerPage.setViewportSize({ width: 320, height: 640 });
  await partnerPage.goto('/bersama/analisis');
  await expect(partnerPage.getByRole('heading', { name: 'Analisis AI', level: 1 })).toBeVisible();

  const bodyText = await partnerPage.locator('main').innerText();
  expect(bodyText).not.toContain(CANARY_CAT);
  expect(bodyText).not.toContain('777.000');

  await noHorizontalScroll(partnerPage);
  await expectNoSeriousViolations(partnerPage);
});
