import { randomUUID } from 'node:crypto';
import { expectNoSeriousViolations } from '../e2e/axe';
import { asUser, noHorizontalScroll, spaceOf } from '../e2e-auth/helpers';
import { adminQuery } from '../e2e-ledger/fixtures';
import { expectRouteBudget } from '../e2e-ledger/helpers';
import { expect, test } from './fixtures';
import { OWNER } from './global-setup';

/**
 * S17 Bersama (@B13):
 * - Ketik cepat di CatatSheet Bersama oleh Farida tidak pernah menyelesaikan dompet kanari Pribadi
 *   milik Novanda dan tidak pernah menyimpan otomatis;
 * - 320 px bebas gulir horizontal, axe 0 pelanggaran serius, budget JS <= 162 kB.
 */
test.describe.configure({ mode: 'serial' });

const CANARY_WALLET = 'KanariDompetPribadi';
const SHARED_WALLET = 'Kas Bersama S17';

function wibToday(): string {
  const ms = Date.now() + 7 * 3_600_000;
  return new Date(ms).toISOString().slice(0, 10);
}

test('Isolasi Bersama: Ketik cepat tidak pernah melihat dompet Pribadi pasangan @B13', async ({
  partnerPage,
  browser,
  partnerState,
}) => {
  const pribadiN = await spaceOf(OWNER, 'personal');
  const bersamaN = await spaceOf(OWNER, 'shared');
  const today = wibToday();

  await asUser(
    pribadiN.uid,
    `select api.create_account($1, $2, $3, 'operasional', 'bank', $4::date, 9000000)`,
    [randomUUID(), pribadiN.sid, CANARY_WALLET, today],
  );
  const [sharedRow] = await asUser<{ r: { account_id: string } }>(
    bersamaN.uid,
    `select api.create_account($1, $2, $3, 'operasional', 'bank', $4::date, 2000000) as r`,
    [randomUUID(), bersamaN.sid, SHARED_WALLET, today],
  );
  const sharedAccId = sharedRow?.r.account_id;
  expect(sharedAccId).toBeTruthy();

  await expectRouteBudget(browser, partnerState, '/bersama/beranda');
  await partnerPage.setViewportSize({ width: 320, height: 640 });
  await partnerPage.goto('/bersama/beranda');

  const [before] = await adminQuery<{ cnt: number }>(
    `select count(*)::int as cnt from app.entries where space_id = $1`,
    [bersamaN.sid],
  );

  await partnerPage.getByRole('button', { name: 'Catat', exact: true }).first().click();
  const dialog = partnerPage.getByRole('dialog');
  await expect(dialog.getByLabel('Ketik cepat')).toBeVisible();

  // Coba sebut nama dompet kanari Pribadi Novanda di Bersama: tidak boleh bocor ke daftar opsi.
  await dialog.getByLabel('Ketik cepat').fill(`kopi 28rb ${CANARY_WALLET}`);
  await dialog.getByRole('button', { name: 'Isi', exact: true }).click();
  await expect(dialog.getByTestId('free-text-preview')).toBeVisible();

  const walletSelectText = await dialog.getByLabel('Dari dompet', { exact: true }).innerText();
  expect(walletSelectText).not.toContain(CANARY_WALLET);

  // Sebut dompet Bersama yang sah → terpilih dengan tepat, tetap tidak auto-simpan.
  await dialog.getByLabel('Ketik cepat').fill(`kopi 28rb ${SHARED_WALLET}`);
  await dialog.getByRole('button', { name: 'Isi', exact: true }).click();
  await expect(dialog.getByLabel('Dari dompet', { exact: true })).toHaveValue(sharedAccId ?? '');

  const [after] = await adminQuery<{ cnt: number }>(
    `select count(*)::int as cnt from app.entries where space_id = $1`,
    [bersamaN.sid],
  );
  expect(after?.cnt).toBe(before?.cnt);

  await noHorizontalScroll(partnerPage);
  await expectNoSeriousViolations(partnerPage);
});
