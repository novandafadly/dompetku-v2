import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations, WCAG_TAGS } from '../e2e/axe';
import { asUser, noHorizontalScroll, spaceOf } from '../e2e-auth/helpers';
import { adminQuery } from '../e2e-ledger/fixtures';
import {
  bersamaResponses,
  digits,
  expectRouteBudget,
  openCatat,
  toasts,
} from '../e2e-ledger/helpers';
import { expect, test } from './fixtures';
import { OWNER, PARTNER } from './global-setup';

/**
 * Tujuan tabungan Bersama (S13 Task 6, K1) dengan dua user di ledger nyata: N membuat tujuan di
 * dompet tabungan Bersama ("Dibuat Novanda" di kedua anggota), F mengubahnya (semua anggota boleh
 * menulis), setoran F dari dompet PRIBADInya (`space_transfer`) menaikkan progres, kartu yang sama
 * di Detail dompet, tujuan Pribadi kanari N tidak sampai ke HTML/RSC pasangan, axe 320, budget JS.
 * Berjalan sesudah `zz-patungan` (nama berkas): data tujuan tidak mengganggu spec lain.
 */
test.describe.configure({ mode: 'serial' });

const SAV = 'Tabungan Bersama E2E';
const GOAL = 'Dana liburan berdua E2E';
const N_SAV = 'KANARI-TABUNGAN-N';
const N_GOAL = 'KANARI-TUJUAN-N';
const TARGET = 5_000_000;
const TARGET_EDIT = 4_000_000;
const SETOR = 1_000_000;

const main = (page: Page) => page.getByRole('main');
const card = (page: Page, name: string) => main(page).getByRole('region', { name, exact: true });
const rp = (n: number) => `Rp ${digits(n)}`;
const rencana = '/bersama/rencana?bagian=tujuan';

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Dompet tabungan lewat `api.create_account` sebagai dompetku_web (seperti action Dompet). */
async function createSavings(email: string, kind: 'personal' | 'shared', name: string) {
  const { uid, sid } = await spaceOf(email, kind);
  const [have] = await adminQuery('select 1 from app.accounts where space_id = $1 and name = $2', [
    sid,
    name,
  ]);
  if (have) return;
  await asUser(
    uid,
    `select api.create_account(p_client_id => $1, p_space_id => $2, p_name => $3,
       p_pocket => 'tabungan', p_wallet_type => 'bank', p_opening_balance => 0::bigint)`,
    [randomUUID(), sid, name],
  );
}

async function goalRow(name: string) {
  const [r] = await adminQuery<{
    status: string;
    target: string;
    updated_by: string;
    created_by: string;
  }>(
    `select status, target_amount::text as target, updated_by::text, created_by::text
       from app.goals where name = $1`,
    [name],
  );
  return r;
}

async function balanceOf(spaceKind: 'personal' | 'shared', email: string, name: string) {
  const { sid } = await spaceOf(email, spaceKind);
  const [r] = await adminQuery<{ b: string }>(
    `select b.balance::text as b from app.accounts a
       join app.account_balances b on b.account_id = a.id where a.space_id = $1 and a.name = $2`,
    [sid, name],
  );
  return Number(r?.b);
}

/** Sheet dimuat malas: ulangi klik sampai tampil (pola spec Tujuan e2e:ledger). */
async function openSheet(page: Page, opener: Locator, sheetName: RegExp, field: RegExp) {
  const sheet = page.getByRole('dialog', { name: sheetName });
  await expect(async () => {
    if ((await sheet.count()) === 0) await opener.click();
    await expect(sheet.getByRole('textbox', { name: field })).toBeVisible({ timeout: 2_000 });
  }).toPass();
  return sheet;
}

/** F setor dari dompet Pribadinya ke dompet tabungan Bersama lewat Catat di `/pribadi`. */
async function setorKeTabungan(page: Page, wallet: string, amount: number) {
  await page.goto('/pribadi/beranda');
  await openCatat(page);
  const expense = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
  await expense.getByRole('button', { name: 'Pengeluaran · Pribadi' }).click();
  await page.getByRole('menuitemradio', { name: 'Transfer' }).click();
  let sheet = page.getByRole('dialog', { name: 'Transfer · Pribadi' });
  await sheet.getByLabel('Dari dompet').selectOption({ label: wallet });
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill(String(amount));
  await sheet.getByRole('button', { name: /pilih dompet di ruang lain/ }).click();
  await page
    .getByRole('radiogroup', { name: 'Dompet di Bersama' })
    .getByRole('radio', { name: new RegExp(SAV) })
    .click();
  sheet = page.getByRole('dialog', { name: 'Transfer · Pribadi → Bersama' });
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page).getByText(`Tersimpan di Pribadi · ${rp(amount)} ke Bersama`),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);
}

test('N membuat tujuan Bersama; "Dibuat Novanda" tampil di N dan F', async ({
  page,
  partnerPage,
  kanari,
}) => {
  expect(kanari.f.wallet).toBe('KANARI-DOMPET-F');
  await createSavings(OWNER, 'shared', SAV);
  await createSavings(OWNER, 'personal', N_SAV);
  // Tujuan Pribadi kanari N lewat fungsi api (bukan UI): hanya bahan uji kebocoran.
  const n = await spaceOf(OWNER, 'personal');
  const [acc] = await adminQuery<{ id: string }>(
    'select id::text from app.accounts where space_id = $1 and name = $2',
    [n.sid, N_SAV],
  );
  await asUser(
    n.uid,
    `select api.create_goal(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_name => $4, p_target_amount => 9876543::bigint, p_target_on => null)`,
    [randomUUID(), n.sid, acc?.id, N_GOAL],
  );

  await page.goto(rencana);
  const sheet = await openSheet(
    page,
    main(page).getByRole('button', { name: 'Tambah tujuan' }).first(),
    /^Tambah tujuan/,
    /Nama tujuan/,
  );
  await sheet.getByRole('textbox', { name: /Nama tujuan/ }).fill(GOAL);
  await sheet.getByRole('textbox', { name: /Target/ }).fill(String(TARGET));
  await sheet.getByLabel(/Tanggal target/).fill(inDays(300));
  await sheet.getByRole('button', { name: 'Simpan tujuan' }).click();
  await expect(toasts(page).getByText(`Tujuan ${GOAL} dibuat di Bersama`)).toBeVisible();
  await expect(card(page, GOAL)).toContainText('Dibuat Novanda');
  await expect(card(page, GOAL)).toContainText(SAV);

  await partnerPage.goto(rencana);
  await expect(card(partnerPage, GOAL)).toContainText('Dibuat Novanda');
  await expect(card(partnerPage, GOAL)).toContainText(rp(TARGET));
  const row = await goalRow(GOAL);
  expect(row).toMatchObject({ status: 'active', target: String(TARGET) });
});

test('F mengubah tujuan yang dibuat N (K1: semua anggota boleh menulis)', async ({
  page,
  partnerPage,
}) => {
  await partnerPage.goto(rencana);
  const sheet = await openSheet(
    partnerPage,
    main(partnerPage).getByRole('button', { name: `Ubah tujuan ${GOAL}` }),
    /^Ubah tujuan/,
    /Target/,
  );
  await expect(sheet.getByText(`Dompet: ${SAV}`)).toBeVisible();
  await sheet.getByRole('textbox', { name: /Target/ }).fill(String(TARGET_EDIT));
  await sheet.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(toasts(partnerPage).getByText(`Tujuan ${GOAL} diperbarui di Bersama`)).toBeVisible();
  await expect(card(partnerPage, GOAL)).toContainText(rp(TARGET_EDIT));
  // Pembuat tetap N; yang mengubah F.
  const row = await goalRow(GOAL);
  expect(row?.target).toBe(String(TARGET_EDIT));
  expect(row?.updated_by).not.toBe(row?.created_by);
  await expect(card(partnerPage, GOAL)).toContainText('Dibuat Novanda');
  await page.goto(rencana);
  await expect(card(page, GOAL)).toContainText(rp(TARGET_EDIT));
});

test('F setor dari dompet Pribadinya ke tabungan Bersama: progres naik di kedua anggota; Detail dompet', async ({
  page,
  partnerPage,
  kanari,
}) => {
  const before = await balanceOf('personal', PARTNER, kanari.f.wallet);
  await setorKeTabungan(partnerPage, kanari.f.wallet, SETOR);
  expect(await balanceOf('personal', PARTNER, kanari.f.wallet)).toBe(before - SETOR);
  expect(await balanceOf('shared', OWNER, SAV)).toBe(SETOR);

  for (const p of [page, partnerPage]) {
    await p.goto(rencana);
    await expect(card(p, GOAL)).toContainText('25%');
    await expect(card(p, GOAL).getByRole('progressbar', { name: GOAL })).toHaveAttribute(
      'aria-valuenow',
      '25',
    );
    await expect(card(p, GOAL)).toContainText(`Sisa ${rp(TARGET_EDIT - SETOR)}`);
    // Detail dompet tabungan Bersama: kartu tujuan yang sama.
    await p.goto('/bersama/dompet');
    await main(p)
      .getByRole('link', { name: new RegExp(SAV) })
      .first()
      .click();
    await expect(p.getByRole('heading', { level: 1, name: SAV })).toBeVisible();
    await expect(card(p, GOAL)).toContainText('25%');
    await expect(card(p, GOAL)).toContainText('Dibuat Novanda');
  }
  // Daftar Dompet Bersama: teks tujuan di baris tabungan.
  await page.goto('/bersama/dompet');
  await expect(main(page).getByRole('link', { name: new RegExp(SAV) })).toContainText(
    `${GOAL} · 25%`,
  );
});

test('tujuan Pribadi kanari N tidak ada di HTML/RSC pasangan maupun ruang Bersama', async ({
  page,
  partnerPage,
}) => {
  test.setTimeout(180_000);
  // Kontrol positif: N sendiri melihat tujuan Pribadinya.
  await page.goto('/pribadi/rencana?bagian=tujuan');
  await expect(card(page, N_GOAL)).toContainText(rp(9_876_543));
  const ids = await adminQuery<{ id: string }>(
    `select a.id::text from app.accounts a where a.name = $1
     union select g.id::text from app.goals g where g.name = $2`,
    [N_SAV, N_GOAL],
  );
  expect(ids).toHaveLength(2);
  const secrets = [N_GOAL, N_SAV, '9.876.543', ...ids.map((r) => r.id)];
  const urls = [
    '/bersama/rencana?bagian=tujuan',
    '/bersama/dompet',
    '/bersama/beranda',
    '/pribadi/rencana?bagian=tujuan',
    '/pribadi/dompet',
  ];
  // Hanya F yang diperiksa pada /pribadi/* (Pribadi F bukan Pribadi N); N pada /bersama/*.
  const checks: [string, Page, string[]][] = [
    ['F', partnerPage, urls],
    ['N', page, urls.filter((u) => u.startsWith('/bersama'))],
  ];
  for (const [who, p, list] of checks) {
    for (const url of list) {
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
      for (const s of secrets) {
        for (const body of [...doc.bodies, html, rsc.body]) {
          expect(body.includes(s), `${who} ${url}: ${s}`).toBe(false);
        }
      }
    }
  }
});

test('axe dan 320 px: Tujuan Bersama, Detail dompet tabungan, sheet Ubah (N dan F); budget JS', async ({
  page,
  partnerPage,
  browser,
  ownerState,
}) => {
  test.setTimeout(180_000);
  for (const p of [page, partnerPage]) {
    await p.setViewportSize({ width: 320, height: 720 });
    for (const url of [rencana, '/bersama/dompet']) {
      await p.goto(url);
      await expect(main(p).getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoSeriousViolations(p, { tags: WCAG_TAGS });
      await noHorizontalScroll(p);
    }
    await p.goto(rencana);
    await expect(card(p, GOAL)).toBeVisible();
  }
  const sheet = await openSheet(
    partnerPage,
    main(partnerPage).getByRole('button', { name: `Ubah tujuan ${GOAL}` }),
    /^Ubah tujuan/,
    /Target/,
  );
  await expect(sheet).toBeVisible();
  await noHorizontalScroll(partnerPage);
  await expectNoSeriousViolations(partnerPage, { tags: WCAG_TAGS });
  await partnerPage.keyboard.press('Escape');
  for (const url of [rencana, '/bersama/dompet']) await expectRouteBudget(browser, ownerState, url);
});
