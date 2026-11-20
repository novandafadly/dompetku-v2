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
 * Aset Bersama (S14 Task 12, K2, B16) dengan dua user di ledger nyata: N membuat aset Bersama (jenis
 * tanpa Saham), F memperbaruinya (semua anggota boleh menulis), setoran F dari dompet Pribadinya ke
 * aset Bersama lewat Catat (`space_transfer`: kekayaan bersih bergeser per ruang, jumlah kedua ruang
 * tetap), aset dan saham Pribadi kanari N tidak sampai ke HTML/RSC pasangan maupun ruang Bersama, dan
 * Bersama tidak punya opsi atau kata saham. Berjalan sesudah `zz-patungan` (nama berkas), serial.
 */
test.describe.configure({ mode: 'serial' });

const ASET = 'Mobil Bersama E2E';
const N_ASET = 'KANARI-ASET-N';
const N_SAHAM = 'KANARI-SEKURITAS-N';
const N_TICKER = 'KNRI';
const OPENING = 90_000_000;
const REVALUED = 85_000_000;
const SETOR = 2_000_000;

const main = (page: Page) => page.getByRole('main');
const rp = (n: number) => `Rp ${digits(n)}`;
const txt = async (l: Locator) => (await l.innerText()).replaceAll(' ', ' ');
const state = { path: '' };

const money = (text: string): number => {
  const m = /(−?)Rp\s([\d.]+)/.exec(text);
  if (!m) throw new Error(`nominal tidak terbaca: ${text}`);
  const n = Number((m[2] ?? '').replaceAll('.', ''));
  return m[1] === '−' ? -n : n;
};

/** Sheet dimuat malas: ulangi klik sampai tampil. */
async function openUntil(open: () => Locator, sheet: Locator, field: Locator) {
  await expect(async () => {
    if ((await sheet.count()) === 0) await open().click();
    await expect(field).toBeVisible({ timeout: 2_000 });
  }).toPass();
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

/** Kekayaan bersih satu ruang dari fungsi SQL yang sama dengan hero (superuser, asersi saja). */
async function netWorth(spaceKind: 'personal' | 'shared', email: string): Promise<number> {
  const { sid } = await spaceOf(email, spaceKind);
  const [r] = await adminQuery<{ total: string }>(
    'select total::text from app.net_worth_at($1, app.today())',
    [sid],
  );
  return Number(r?.total);
}

const heroTotal = async (page: Page, ruang: 'pribadi' | 'bersama') => {
  await page.goto(`/${ruang}/dompet`);
  return money(await txt(page.getByTestId('net-worth')));
};

test('N membuat aset Bersama (jenis tanpa Saham); F melihatnya di Dompet dan hero Bersama', async ({
  page,
  partnerPage,
  kanari,
}) => {
  expect(kanari.f.wallet).toBe('KANARI-DOMPET-F');
  const n0 = await heroTotal(page, 'bersama');
  await page.goto('/bersama/dompet');
  const sheet = page.getByRole('dialog', { name: /^Tambah aset · Bersama/ });
  await openUntil(
    () =>
      main(page)
        .getByRole('button', { name: /Tambah aset/ })
        .first(),
    sheet,
    sheet.getByLabel('Jenis aset'),
  );
  // Bersama tidak menawarkan jenis Saham (hanya Pribadi, K2).
  const options = await sheet.getByLabel('Jenis aset').locator('option').allInnerTexts();
  expect(options.some((o) => /saham/i.test(o))).toBe(false);
  expect(options).toContain('Kendaraan');
  await sheet.getByLabel('Jenis aset').selectOption('kendaraan');
  await sheet.getByRole('textbox', { name: 'Nama' }).fill(ASET);
  await sheet.getByRole('textbox', { name: 'Nilai sekarang' }).fill(String(OPENING));
  await sheet.getByRole('button', { name: 'Simpan aset' }).click();
  await expect(toasts(page).getByText(`Aset ${ASET} ditambahkan di Bersama`)).toBeVisible();

  const { sid } = await spaceOf(OWNER, 'shared');
  const [row] = await adminQuery<{ id: string; kind: string; created_by: string }>(
    `select a.id::text, d.asset_kind as kind, a.created_by::text from app.accounts a
       join app.asset_details d on d.account_id = a.id where a.space_id = $1 and a.name = $2`,
    [sid, ASET],
  );
  expect(row).toMatchObject({ kind: 'kendaraan' });
  state.path = `/bersama/dompet/${row?.id ?? ''}`;

  expect(await heroTotal(page, 'bersama')).toBe(n0 + OPENING);
  for (const p of [page, partnerPage]) {
    await p.goto('/bersama/dompet');
    const link = main(p)
      .getByRole('region', { name: 'Aset' })
      .getByRole('link', { name: new RegExp(`^${ASET}`) });
    await expect(link).toContainText('Kendaraan');
    await expect(link).toContainText(rp(OPENING));
    await expect(main(p).getByText('Kas dan aset bersama.')).toBeVisible();
    // Tidak ada kata saham di layar Dompet Bersama.
    expect(await txt(main(p))).not.toMatch(/saham/i);
  }
});

test(
  'F memperbarui nilai aset yang dibuat N (K2): kedua anggota melihat nilai baru; Laporan Bersama tidak berubah',
  { tag: ['@T11'] },
  async ({ page, partnerPage }) => {
    const nw0 = await netWorth('shared', OWNER);
    const [sums0] = await adminQuery<{ x: string }>(
      `select coalesce(sum(l.amount) filter (where e.kind in ('income', 'expense')), 0)::text as x
         from app.entries e join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
        where e.space_id = $1 and e.voided_at is null`,
      [(await spaceOf(OWNER, 'shared')).sid],
    );
    await partnerPage.goto(state.path);
    const sheet = partnerPage.getByRole('dialog', { name: new RegExp(`^Perbarui nilai ${ASET}`) });
    const field = sheet.getByRole('textbox', { name: 'Nilai sekarang' });
    await openUntil(
      () => main(partnerPage).getByRole('button', { name: 'Perbarui nilai' }),
      sheet,
      field,
    );
    await field.fill(String(REVALUED));
    await expect(sheet.getByText(`Turun ${rp(OPENING - REVALUED)}`)).toBeVisible();
    await sheet.getByRole('button', { name: 'Simpan nilai' }).click();
    await expect(toasts(partnerPage).getByText(`Nilai ${ASET} diperbarui`)).toBeVisible();

    expect(await balanceOf('shared', OWNER, ASET)).toBe(REVALUED);
    expect(await netWorth('shared', OWNER)).toBe(nw0 - (OPENING - REVALUED));
    const [v] = await adminQuery<{ by: string; owner: string }>(
      `select e.created_by::text as by, a.created_by::text as owner from app.entries e
         join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
         join app.accounts a on a.id = l.account_id
        where e.kind = 'valuation' and e.voided_at is null and a.name = $1`,
      [ASET],
    );
    expect(v?.by).not.toBe(v?.owner);
    const [sums1] = await adminQuery<{ x: string }>(
      `select coalesce(sum(l.amount) filter (where e.kind in ('income', 'expense')), 0)::text as x
         from app.entries e join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
        where e.space_id = $1 and e.voided_at is null`,
      [(await spaceOf(OWNER, 'shared')).sid],
    );
    expect(sums1?.x).toBe(sums0?.x);

    for (const p of [page, partnerPage]) {
      await p.goto(state.path);
      await expect(p.getByTestId('wallet-balance')).toContainText(rp(REVALUED));
      await expect(
        main(p)
          .getByRole('link', { name: /Perubahan nilai/ })
          .first(),
      ).toContainText('Turun');
    }
  },
);

test(
  'F setor dari dompet Pribadinya ke aset Bersama: per ruang bergeser, jumlah kedua ruang tetap (B16)',
  { tag: ['@B16', '@T11'] },
  async ({ page, partnerPage, kanari }) => {
    const fPersonal0 = await netWorth('personal', PARTNER);
    const shared0 = await netWorth('shared', OWNER);
    const wallet0 = await balanceOf('personal', PARTNER, kanari.f.wallet);

    await partnerPage.goto('/pribadi/beranda');
    await openCatat(partnerPage);
    const expense = partnerPage.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
    await expense.getByRole('button', { name: 'Pengeluaran · Pribadi' }).click();
    await partnerPage.getByRole('menuitemradio', { name: 'Transfer' }).click();
    let sheet = partnerPage.getByRole('dialog', { name: 'Transfer · Pribadi' });
    await sheet.getByLabel('Dari dompet').selectOption({ label: kanari.f.wallet });
    await sheet.getByRole('textbox', { name: 'Nominal' }).fill(String(SETOR));
    await sheet.getByRole('button', { name: /pilih dompet di ruang lain/ }).click();
    await partnerPage
      .getByRole('radiogroup', { name: 'Dompet di Bersama' })
      .getByRole('radio', { name: new RegExp(ASET) })
      .click();
    sheet = partnerPage.getByRole('dialog', { name: 'Transfer · Pribadi → Bersama' });
    await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect(
      toasts(partnerPage).getByText(`Tersimpan di Pribadi · ${rp(SETOR)} ke Bersama`),
    ).toBeVisible();

    expect(await balanceOf('personal', PARTNER, kanari.f.wallet)).toBe(wallet0 - SETOR);
    expect(await balanceOf('shared', OWNER, ASET)).toBe(REVALUED + SETOR);
    const fPersonal1 = await netWorth('personal', PARTNER);
    const shared1 = await netWorth('shared', OWNER);
    expect(fPersonal1).toBe(fPersonal0 - SETOR);
    expect(shared1).toBe(shared0 + SETOR);
    expect(fPersonal1 + shared1).toBe(fPersonal0 + shared0);

    // Hero tiap ruang membaca angka yang sama dengan SQL.
    expect(await heroTotal(partnerPage, 'pribadi')).toBe(fPersonal1);
    expect(await heroTotal(page, 'bersama')).toBe(shared1);
    expect(await heroTotal(partnerPage, 'bersama')).toBe(shared1);
  },
);

test(
  'aset dan saham Pribadi kanari N tidak ada di HTML/RSC pasangan maupun ruang Bersama; pasangan tidak bisa menulis',
  { tag: ['@B23', '@B24'] },
  async ({ page, partnerPage }) => {
    test.setTimeout(180_000);
    const n = await spaceOf(OWNER, 'personal');
    const mk = async (name: string, kind: string, opening: number) => {
      const [r] = await asUser<{ r: { account_id: string } }>(
        n.uid,
        `select api.create_account(p_client_id => $1, p_space_id => $2, p_name => $3,
           p_pocket => 'aset'::app.pocket, p_wallet_type => 'cash', p_opening_balance => $5::bigint,
           p_asset_kind => $4) as r`,
        [randomUUID(), n.sid, name, kind, opening],
      );
      return r?.r.account_id ?? '';
    };
    const aset = await mk(N_ASET, 'emas', 7_654_321);
    const sekuritas = await mk(N_SAHAM, 'saham', 0);
    await asUser(
      n.uid,
      `select api.open_stock_holding($1, $2, $3, 777::bigint, 4321::bigint, app.today() - 3)`,
      [randomUUID(), sekuritas, N_TICKER],
    );
    await asUser(
      n.uid,
      `select api.set_stock_price($1, $2, $3, app.today() - 1, 4999::bigint, true)`,
      [randomUUID(), n.sid, N_TICKER],
    );

    // Kontrol positif: N melihat sendiri aset dan saham di Pribadinya.
    await page.goto('/pribadi/dompet');
    await expect(main(page).getByRole('link', { name: new RegExp(`^${N_ASET}`) })).toBeVisible();
    await expect(main(page).getByRole('link', { name: new RegExp(`^${N_SAHAM}`) })).toBeVisible();
    await page.goto(`/pribadi/dompet/${sekuritas}`);
    await expect(page.getByTestId(`holding-${N_TICKER}`)).toBeVisible();

    const secrets = [N_ASET, N_SAHAM, N_TICKER, '7.654.321', '4.999', aset, sekuritas];
    const urls = [
      '/bersama/dompet',
      '/bersama/beranda',
      '/bersama/transaksi',
      '/pribadi/dompet',
      '/pribadi/transaksi',
      `/pribadi/dompet/${aset}`,
      `/pribadi/dompet/${sekuritas}`,
    ];
    // Hanya F diperiksa pada /pribadi/* (Pribadi F bukan Pribadi N); N pada /bersama/*.
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
        const html = await p.content();
        for (const s of secrets) {
          for (const body of [...doc.bodies, html, rsc.body]) {
            expect(body.includes(s), `${who} ${url}: ${s}`).toBe(false);
          }
        }
      }
    }
    // Bersama tidak punya kata saham di layar Dompet/Detail aset.
    for (const p of [page, partnerPage]) {
      for (const url of ['/bersama/dompet', state.path]) {
        await p.goto(url);
        expect(await txt(main(p))).not.toMatch(/saham/i);
      }
    }

    // F tidak bisa menulis ke aset/saham Pribadi N lewat jalur API.
    const f = await spaceOf(PARTNER, 'personal');
    const attempts: [string, unknown[]][] = [
      ['select api.revalue_asset($1, $2, 1::bigint, app.today())', [randomUUID(), aset]],
      [
        `select api.buy_stock($1, $2, 'ABCD', 1::bigint, 1000::bigint, 0::bigint, $3, app.today())`,
        [randomUUID(), sekuritas, f.sid],
      ],
      [
        `select api.set_stock_price($1, $2, 'KNRI', app.today(), 4999::bigint, true)`,
        [randomUUID(), n.sid],
      ],
    ];
    for (const [sql, params] of attempts) {
      await expect(asUser(f.uid, sql, params)).rejects.toThrow(/DK404|not_found|42501|permission/i);
    }
    expect(await balanceOf('personal', OWNER, N_ASET)).toBe(7_654_321);
  },
);

test('axe dan 320 px: Dompet Bersama dengan aset, Detail aset, sheet Perbarui nilai; budget JS', async ({
  page,
  partnerPage,
  browser,
  ownerState,
}) => {
  test.setTimeout(180_000);
  for (const p of [page, partnerPage]) {
    await p.setViewportSize({ width: 320, height: 720 });
    for (const url of ['/bersama/dompet', state.path]) {
      await p.goto(url);
      await expect(main(p).getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoSeriousViolations(p, { tags: WCAG_TAGS });
      await noHorizontalScroll(p);
    }
  }
  await partnerPage.goto(state.path);
  const sheet = partnerPage.getByRole('dialog', { name: new RegExp(`^Perbarui nilai ${ASET}`) });
  await openUntil(
    () => main(partnerPage).getByRole('button', { name: 'Perbarui nilai' }),
    sheet,
    sheet.getByRole('textbox', { name: 'Nilai sekarang' }),
  );
  await noHorizontalScroll(partnerPage);
  await expectNoSeriousViolations(partnerPage, { tags: WCAG_TAGS });
  await partnerPage.keyboard.press('Escape');
  for (const url of ['/bersama/dompet', state.path]) {
    await expectRouteBudget(browser, ownerState, url);
  }
});
