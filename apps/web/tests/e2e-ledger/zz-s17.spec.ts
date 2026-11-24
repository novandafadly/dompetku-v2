import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../e2e/axe';
import { asUser, noHorizontalScroll, spaceOf } from '../e2e-auth/helpers';
import { adminQuery, expect, test } from './fixtures';
import { OWNER } from './global-setup';
import { expectRouteBudget } from './helpers';

/**
 * S17 mode nyata (e2e:ledger):
 * - Ketik cepat di CatatSheet mengisi draf + banner pratinjau wajib konfirmasi (ANTI auto-simpan);
 * - Hanya tersimpan ke app.entries setelah pengguna menekan Simpan;
 * - Galat tanpa nominal & tanggal masa depan tampil jelas dalam Bahasa Indonesia;
 * - 320 px bebas gulir horizontal, axe 0 pelanggaran serius, budget JS <= 162 kB.
 */
test.describe.configure({ mode: 'serial' });

const WALLET = 'BCA S17';

function wibOffset(days: number): string {
  const ms = Date.now() + 7 * 3_600_000 + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

async function openCatat(page: Page) {
  await page.getByRole('button', { name: 'Catat', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Ketik cepat')).toBeVisible();
  return dialog;
}

test('Ketik cepat mengisi pratinjau tanpa auto-simpan lalu tersimpan saat klik Simpan', async ({
  page,
}) => {
  const { uid, sid } = await spaceOf(OWNER, 'personal');
  const today = wibOffset(0);

  const [accRow] = await asUser<{ r: { account_id: string } }>(
    uid,
    `select api.create_account($1, $2, $3, 'operasional', 'bank', $4::date, 2000000) as r`,
    [randomUUID(), sid, WALLET, today],
  );
  const accId = accRow?.r.account_id;
  expect(accId).toBeTruthy();

  await page.goto('/pribadi/beranda');
  await expect(page.getByRole('main')).toBeVisible();

  const [before] = await adminQuery<{ cnt: number }>(
    `select count(*)::int as cnt from app.entries where space_id = $1`,
    [sid],
  );

  const dialog = await openCatat(page);
  await dialog.getByLabel('Ketik cepat').fill('makan siang 35rb bca s17');
  await dialog.getByRole('button', { name: 'Isi', exact: true }).click();

  const banner = dialog.getByTestId('free-text-preview');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Terbaca otomatis. Periksa isian di bawah sebelum simpan.');

  // Anti auto-simpan: jumlah entri di DB WAJIB tetap sama sebelum pengguna menekan Simpan.
  const [afterParse] = await adminQuery<{ cnt: number }>(
    `select count(*)::int as cnt from app.entries where space_id = $1`,
    [sid],
  );
  expect(afterParse?.cnt).toBe(before?.cnt);

  // Draf terisi: nominal, dompet, keterangan.
  await expect(dialog.getByLabel('Nominal')).toHaveValue('35.000');
  await expect(dialog.getByLabel('Dari dompet')).toHaveValue(accId ?? '');
  await expect(dialog.getByLabel(/^Keterangan/)).toHaveValue('makan siang');

  // Pilih kategori jika belum terpilih otomatis, lalu klik Simpan.
  const saveBtn = dialog.getByRole('button', { name: /Simpan/i });
  if ((await saveBtn.getAttribute('aria-disabled')) === 'true') {
    await dialog.getByRole('radio').first().click();
  }
  await saveBtn.click();
  await expect(dialog).toBeHidden();

  const [afterSave] = await adminQuery<{ cnt: number }>(
    `select count(*)::int as cnt from app.entries where space_id = $1 and description = 'makan siang'`,
    [sid],
  );
  expect(afterSave?.cnt).toBeGreaterThanOrEqual(1);
});

test('Galat Ketik cepat (tanpa nominal & tanggal masa depan), 320px, axe, dan budget JS', async ({
  page,
  browser,
  ownerState,
}) => {
  await expectRouteBudget(browser, ownerState, '/pribadi/beranda');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/pribadi/beranda');

  const dialog = await openCatat(page);

  await dialog.getByLabel('Ketik cepat').fill('cuma teks tanpa nominal');
  await dialog.getByRole('button', { name: 'Isi', exact: true }).click();
  await expect(dialog.getByTestId('free-text-error')).toContainText('Nominal belum terbaca');

  await dialog.getByLabel('Ketik cepat').fill('kopi 25rb besok');
  await dialog.getByRole('button', { name: 'Isi', exact: true }).click();
  await expect(dialog.getByTestId('free-text-error')).toContainText(
    'Tanggal di masa depan belum didukung',
  );

  // Uji pratinjau di 320 px: bebas overflow dan bebas pelanggaran axe serius.
  await dialog.getByLabel('Ketik cepat').fill('kopi 25rb bca s17');
  await dialog.getByRole('button', { name: 'Isi', exact: true }).click();
  await expect(dialog.getByTestId('free-text-preview')).toBeVisible();
  await noHorizontalScroll(page);
  await expectNoSeriousViolations(page);
});
