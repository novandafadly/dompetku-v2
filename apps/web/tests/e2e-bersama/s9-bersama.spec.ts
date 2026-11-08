import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations, WCAG_TAGS } from '../e2e/axe';
import { asUser, createWallet, noHorizontalScroll, spaceOf } from '../e2e-auth/helpers';
import { adminQuery } from '../e2e-ledger/fixtures';
import { bersamaResponses, expectRouteBudget, toasts } from '../e2e-ledger/helpers';
import { expect, test } from './fixtures';
import { OWNER, PARTNER } from './global-setup';

/**
 * Kriteria keluar S9 dua user (plan Task 15, B13): kanari tagihan dan anggaran Pribadi N dan F
 * (`KANARI-N-TAGIHAN`/`KANARI-N-KATEGORI`, `KANARI-F-*`) tidak pernah sampai ke HTML maupun
 * payload RSC (`RSC: 1`, navigasi klien) `/bersama/laporan`, `/bersama/rencana` (dua segmen), dan
 * `/bersama/beranda` untuk N dan F; F membayar tagihan Bersama yang dibuat N (Aktivitas
 * menampilkan `Farida` + pengeluaran tagihan) tanpa bisa memilih dompet Pribadi siapa pun;
 * Kontribusi dua anggota di Laporan Bersama = SQL `api.member_contributions`; axe dan budget JS
 * rute S9 dua anggota. Data sendiri (nama unik, idempoten), jalan sesudah `s8.spec.ts`.
 */
test.describe.configure({ mode: 'serial' });

const KAS = 'Kas Bersama S9';
const BILL = 'Listrik Bersama S9';
const BILL_AMOUNT = 351_000;
const DAPUR = 'Belanja Dapur';
const SETOR_N = 123_000;
const SETOR_F = 214_000;
/** Kanari Pribadi S9 per orang: kategori beranggaran + tagihan, nominal khas. */
const K9 = {
  n: {
    email: OWNER,
    wallet: 'KANARI-DOMPET-N',
    category: 'KANARI-N-KATEGORI',
    bill: 'KANARI-N-TAGIHAN',
    budget: 7_123_456,
    billAmount: 7_234_567,
  },
  f: {
    email: PARTNER,
    wallet: 'KANARI-DOMPET-F',
    category: 'KANARI-F-KATEGORI',
    bill: 'KANARI-F-TAGIHAN',
    budget: 6_123_456,
    billAmount: 6_234_567,
  },
} as const;

const main = (page: Page) => page.getByRole('main');
const digits = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const paySheet = (page: Page) =>
  page.getByRole('dialog', { name: /^Bayar .+\s(Pribadi|Bersama)$/ });
const payBtn = (page: Page, name: string) =>
  main(page).getByRole('button', { name: new RegExp(`^Bayar ${name}, Rp`) });

async function openUntil(open: () => Locator, sheet: Locator, field: Locator) {
  await expect(async () => {
    if ((await sheet.count()) === 0) await open().click();
    await expect(field).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

/** Periode berjalan dari SQL (`api.pay_period`, sama dengan loader). */
async function period(uid: string, sid: string) {
  const [p] = await asUser<{ f: string; t: string; l: string }>(
    uid,
    `select to_char(starts_on, 'YYYY-MM-DD') as f, to_char(ends_on, 'YYYY-MM-DD') as t,
            to_char(label_month, 'YYYY-MM-DD') as l from api.pay_period($1)`,
    [sid],
  );
  if (!p) throw new Error('periode');
  return p;
}

/** Kanari tagihan + kategori beranggaran + pengeluaran di Pribadi satu orang (idempoten). */
async function seedKanariS9(k: (typeof K9)['n'] | (typeof K9)['f']): Promise<void> {
  const { uid, sid } = await spaceOf(k.email, 'personal');
  const p = await period(uid, sid);
  const one = async (sql: string, params: unknown[]) =>
    (await adminQuery<{ id: string }>(sql, params))[0]?.id ?? null;
  let cat = await one('select id::text from app.categories where space_id = $1 and name = $2', [
    sid,
    k.category,
  ]);
  if (cat === null) {
    await asUser(
      uid,
      `select api.create_category(p_client_id => $1, p_space_id => $2, p_type => 'expense',
         p_name => $3, p_icon => 'Receipt')`,
      [randomUUID(), sid, k.category],
    );
    cat = await one('select id::text from app.categories where space_id = $1 and name = $2', [
      sid,
      k.category,
    ]);
  }
  await asUser(uid, `select api.set_budget($1, $2, $3::date, $4::bigint, false)`, [
    sid,
    cat,
    p.l,
    k.budget,
  ]);
  const bill = await one('select id::text from app.bills where space_id = $1 and name = $2', [
    sid,
    k.bill,
  ]);
  if (bill === null) {
    await asUser(
      uid,
      `select api.create_bill(p_client_id => $1, p_space_id => $2, p_name => $3,
         p_amount => $4::bigint, p_category_id => $5, p_day_of_month => 28::smallint,
         p_starts_on => $6::date)`,
      [randomUUID(), sid, k.bill, k.billAmount, cat, p.f],
    );
    const acc = await one('select id::text from app.accounts where space_id = $1 and name = $2', [
      sid,
      k.wallet,
    ]);
    await asUser(
      uid,
      `select api.create_entry(p_client_id => $1, p_space_id => $2, p_account_id => $3,
         p_kind => 'expense', p_amount => 11111::bigint, p_category_id => $4)`,
      [randomUUID(), sid, acc, cat],
    );
  }
}

/** Semua yang tidak boleh ada di respons Bersama: teks kanari, nominal, nama, dan id Pribadi. */
async function forbidden(): Promise<string[]> {
  const ids = await adminQuery<{ id: string }>(
    `select c.id::text from app.categories c join app.spaces s on s.id = c.space_id
      where s.kind = 'personal'
     union select b.id::text from app.bills b join app.spaces s on s.id = b.space_id
            where s.kind = 'personal'
     union select o.id::text from app.bill_occurrences o join app.spaces s on s.id = o.space_id
            where s.kind = 'personal'
     union select a.id::text from app.accounts a join app.spaces s on s.id = a.space_id
            where s.kind = 'personal'
     union select id::text from app.spaces where kind = 'personal'`,
  );
  const names = await adminQuery<{ name: string }>(
    `select a.name from app.accounts a join app.spaces s on s.id = a.space_id
      where s.kind = 'personal'`,
  );
  const amounts = [K9.n.budget, K9.n.billAmount, K9.f.budget, K9.f.billAmount];
  return [
    'KANARI',
    ...amounts.flatMap((a) => [digits(a), String(a)]),
    ...names.map((n) => n.name),
    ...ids.map((r) => r.id),
  ];
}

const ROUTES = [
  '/bersama/laporan',
  '/bersama/rencana',
  '/bersama/rencana?bagian=tagihan',
  '/bersama/beranda',
] as const;

test.beforeAll(async () => {
  const { sid } = await spaceOf(OWNER, 'shared');
  const rows = await adminQuery('select 1 from app.accounts where space_id = $1 and name = $2', [
    sid,
    KAS,
  ]);
  if (rows.length === 0) await createWallet(OWNER, 'shared', KAS, 3_000_000);
});

test('siapkan: kanari Pribadi S9 N dan F; tagihan dan anggaran Bersama oleh N; setoran dua anggota', async ({
  kanari,
}) => {
  expect(kanari.n.wallet).toBe(K9.n.wallet);
  expect(kanari.f.wallet).toBe(K9.f.wallet);
  for (const k of [K9.n, K9.f]) await seedKanariS9(k);
  const sh = await spaceOf(OWNER, 'shared');
  const p = await period(sh.uid, sh.sid);
  const [ids] = await adminQuery<{ kas: string; listrik: string; dapur: string }>(
    `select (select id::text from app.accounts where space_id = $1 and name = $2) as kas,
            (select id::text from app.categories where space_id = $1 and name = 'Listrik & Air') as listrik,
            (select id::text from app.categories where space_id = $1 and name = $3) as dapur`,
    [sh.sid, KAS, DAPUR],
  );
  if (!ids) throw new Error('id Bersama');
  const exists = await adminQuery('select 1 from app.bills where space_id = $1 and name = $2', [
    sh.sid,
    BILL,
  ]);
  if (exists.length > 0) return;
  await asUser(
    sh.uid,
    `select api.create_bill(p_client_id => $1, p_space_id => $2, p_name => $3,
       p_amount => $4::bigint, p_category_id => $5, p_day_of_month => 28::smallint,
       p_starts_on => $6::date, p_account_id => $7)`,
    [randomUUID(), sh.sid, BILL, BILL_AMOUNT, ids.listrik, p.f, ids.kas],
  );
  await asUser(sh.uid, `select api.set_budget($1, $2, $3::date, 2000000::bigint, false)`, [
    sh.sid,
    ids.dapur,
    p.l,
  ]);
  // Setoran Pribadi → Bersama oleh masing-masing anggota (Kontribusi dua anggota).
  for (const [email, wallet, amount] of [
    [OWNER, K9.n.wallet, SETOR_N],
    [PARTNER, K9.f.wallet, SETOR_F],
  ] as const) {
    const { uid, sid } = await spaceOf(email, 'personal');
    const [a] = await adminQuery<{ id: string }>(
      'select id::text from app.accounts where space_id = $1 and name = $2',
      [sid, wallet],
    );
    await asUser(
      uid,
      `select api.create_transfer(p_client_id => $1, p_space_id => $2, p_from_account => $3,
         p_to_account => $4, p_amount => $5::bigint)`,
      [randomUUID(), sid, a?.id, ids.kas, amount],
    );
  }
});

test(
  'B13: HTML + payload RSC Laporan, Rencana (dua segmen), Beranda Bersama untuk N dan F tanpa kanari Pribadi',
  { tag: ['@B13'] },
  async ({ page, partnerPage }) => {
    test.setTimeout(240_000);
    const secrets = await forbidden();
    const expectClean = (who: string, bodies: string[]) => {
      expect(bodies.length, who).toBeGreaterThan(0);
      for (const body of bodies) {
        for (const s of secrets) expect(body.includes(s), `${who}: ${s}`).toBe(false);
      }
    };
    for (const [who, p] of [
      ['N', page],
      ['F', partnerPage],
    ] as const) {
      for (const url of ROUTES) {
        // Muat dokumen (HTML + RSC yang dialirkan + prefetch).
        const doc = await bersamaResponses(p, () => p.goto(url));
        expect(doc.unread, `${who} ${url}`).toEqual([]);
        expectClean(`${who} ${url}`, doc.bodies);
        // Kontrol positif: halaman benar-benar memuat data Bersama yang diperiksa.
        const html = doc.bodies.join('\n');
        if (url.includes('tagihan')) expect(html).toContain(BILL);
        if (url.endsWith('beranda')) expect(html).toContain('Aman dipakai bersama');
        if (url.endsWith('laporan')) expect(html).toContain('Kontribusi per orang');
        if (url === '/bersama/rencana') expect(html).toContain(DAPUR);
        // Payload RSC langsung (header `RSC: 1`, seperti navigasi klien Next) dari browser yang
        // sama: cookie sesi `__Host-` ikut seperti permintaan aplikasi sendiri. Next 16 mewajibkan
        // parameter `_rsc` = hash header router; tanpa header router lain hash-nya kosong.
        const rsc = await p.evaluate(async (u) => {
          const r = await fetch(`${u}${u.includes('?') ? '&' : '?'}_rsc`, {
            headers: { RSC: '1' },
            redirect: 'manual',
          });
          return {
            status: r.status,
            type: r.headers.get('content-type') ?? '',
            body: await r.text(),
          };
        }, url);
        expect(rsc.status, `${who} RSC ${url}`).toBe(200);
        expect(rsc.type).toContain('text/x-component');
        // Penanda khas tiap rute/segmen (sama dengan kontrol HTML di atas): segmen Anggaran
        // (`/bersama/rencana` tanpa `bagian`) = kategori beranggaran, bukan nama tagihan.
        expect(rsc.body).toContain(
          url.includes('laporan')
            ? 'Kontribusi per orang'
            : url.includes('beranda')
              ? 'Aman dipakai bersama'
              : url === '/bersama/rencana'
                ? DAPUR
                : BILL,
        );
        expectClean(`${who} RSC ${url}`, [rsc.body]);
      }
      // Navigasi klien: Beranda → tab Rencana → segmen Tagihan → Menu Laporan.
      await p.setViewportSize({ width: 390, height: 844 });
      await p.goto('/bersama/beranda');
      const nav = await bersamaResponses(p, async () => {
        await p
          .getByRole('navigation', { name: 'Tab utama' })
          .getByRole('link', { name: 'Rencana' })
          .click();
        await expect(p).toHaveURL(/\/bersama\/rencana$/);
        await main(p)
          .getByRole('navigation', { name: 'Bagian Rencana' })
          .getByRole('link', { name: 'Tagihan' })
          .click();
        await expect(p).toHaveURL(/\/bersama\/rencana\?bagian=tagihan$/);
        await expect(
          main(p).locator('[data-bill-row]').filter({ hasText: BILL }).first(),
        ).toBeVisible();
        await p.getByRole('button', { name: 'Menu' }).first().click();
        await p
          .getByRole('dialog', { name: 'Menu' })
          .getByRole('link', { name: 'Laporan' })
          .click();
        await expect(p).toHaveURL(/\/bersama\/laporan$/);
        await expect(p.getByTestId('laporan-kontribusi')).toBeVisible();
      });
      expect(nav.unread, `${who} navigasi`).toEqual([]);
      expectClean(`${who} navigasi klien`, nav.bodies);
    }
    // Kontrol positif lintas ruang: kanari ada di Pribadi masing-masing (bukan string mati).
    // Tiap orang: tagihan dan kategori beranggaran (dengan nominal khasnya) miliknya sendiri.
    for (const [pg, own, other] of [
      [page, K9.n, K9.f],
      [partnerPage, K9.f, K9.n],
    ] as const) {
      await pg.goto('/pribadi/rencana?bagian=tagihan');
      await expect(main(pg)).toContainText(own.bill);
      await expect(main(pg)).not.toContainText(other.bill);
      await pg.goto('/pribadi/rencana');
      const row = main(pg).locator('[data-budget-row]').filter({ hasText: own.category });
      await expect(row).toBeVisible();
      await expect(row).toContainText(`dari Rp ${digits(own.budget)}`);
      await expect(main(pg)).not.toContainText(other.category);
    }
  },
);

test(
  'F membayar tagihan Bersama yang dibuat N: hanya dompet Bersama, Aktivitas menampilkan Farida',
  { tag: ['@B13'] },
  async ({ page, partnerPage }) => {
    test.setTimeout(120_000);
    const sh = await spaceOf(OWNER, 'shared');
    await partnerPage.goto('/bersama/rencana?bagian=tagihan');
    const sheet = paySheet(partnerPage);
    await openUntil(
      () => payBtn(partnerPage, BILL).first(),
      sheet,
      sheet.getByRole('textbox', { name: 'Nominal' }),
    );
    // Pilihan dompet = dompet aktif Bersama saja (bukan Pribadi N, bukan Pribadi F).
    const options = await sheet
      .getByRole('combobox', { name: 'Dompet' })
      .locator('option')
      .allInnerTexts();
    const shared = await adminQuery<{ name: string }>(
      `select name from app.accounts where space_id = $1 and archived_at is null
          and pocket <> 'kantor'`,
      [sh.sid],
    );
    const personal = await adminQuery<{ name: string }>(
      `select a.name from app.accounts a join app.spaces s on s.id = a.space_id
        where s.kind = 'personal'`,
    );
    expect(options).toContain(KAS);
    for (const o of options) {
      if (o.trim() === '' || o.startsWith('Pilih')) continue;
      expect(
        shared.map((r) => r.name),
        o,
      ).toContain(o.trim());
    }
    for (const { name } of personal) expect(options).not.toContain(name);
    await sheet.getByRole('combobox', { name: 'Dompet' }).selectOption({ label: KAS });
    await sheet
      .getByRole('button', { name: new RegExp(`^Bayar Rp\\s${digits(BILL_AMOUNT)}$`) })
      .click();
    await expect(
      toasts(partnerPage).getByText(
        `Tagihan ${BILL} dibayar di Bersama · Rp ${digits(BILL_AMOUNT)} dari ${KAS}`,
      ),
    ).toBeVisible();
    const rows = await adminQuery<{ by: string }>(
      `select p.display_name as by from app.entries e join app.profiles p on p.user_id = e.created_by
        where e.space_id = $1 and e.description = $2 and e.voided_at is null`,
      [sh.sid, BILL],
    );
    expect(rows).toEqual([{ by: 'Farida' }]);
    // N melihat pembayaran F di Aktivitas (Beranda Bersama dan halaman Aktivitas).
    await page.goto('/bersama/beranda');
    const feed = main(page).getByRole('region', { name: /^Aktivitas/ });
    const first = feed.getByRole('listitem').first();
    await expect(first).toContainText(new RegExp(`Farida\\s·\\smencatat pengeluaran ${BILL}`));
    await expect(first).toContainText(`Rp ${digits(BILL_AMOUNT)}`);
    await expect(feed).not.toContainText(KAS);
    await page.goto('/bersama/aktivitas');
    await expect(
      main(page)
        .getByRole('listitem')
        .filter({ hasText: `mencatat pengeluaran ${BILL}` })
        .first(),
    ).toContainText('Farida');
    await page.goto('/bersama/rencana?bagian=tagihan');
    await expect(
      main(page).locator('[data-bill-row]').filter({ hasText: BILL }).first(),
    ).toContainText(/Lunas · /);
  },
);

test('Kontribusi dua anggota di Laporan Bersama = SQL member_contributions periode yang sama (N dan F)', async ({
  page,
  partnerPage,
}) => {
  const sh = await spaceOf(OWNER, 'shared');
  const p = await period(sh.uid, sh.sid);
  const rows = await asUser<{ uid: string; setoran: string; diambil: string }>(
    sh.uid,
    `select user_id::text as uid, setoran::text, diambil::text
       from api.member_contributions($1, $2::date, $3::date)`,
    [sh.sid, p.f, p.t],
  );
  // Nama dari superuser (RLS profil hanya baris sendiri untuk dompetku_web).
  const names = await adminQuery<{ uid: string; name: string }>(
    'select user_id::text as uid, display_name as name from app.profiles',
  );
  const sql = rows
    .map((r) => ({ ...r, name: names.find((x) => x.uid === r.uid)?.name ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  expect(sql.map((r) => r.name)).toEqual(['Farida', 'Novanda']);
  // Setoran tiap anggota minimal setoran yang dibuat spec ini (spec lain boleh menambah).
  const minSetor: Record<string, number> = { Novanda: SETOR_N, Farida: SETOR_F };
  for (const r of sql) {
    expect(Number(r.setoran), r.name).toBeGreaterThanOrEqual(minSetor[r.name] ?? Infinity);
  }
  for (const pg of [page, partnerPage]) {
    await pg.goto('/bersama/laporan');
    const card = pg.getByTestId('laporan-kontribusi');
    await expect(card.getByRole('listitem')).toHaveCount(2);
    for (const r of sql) {
      const li = card.getByRole('listitem').filter({ hasText: r.name });
      await expect(li).toContainText(`Setor Rp ${digits(Number(r.setoran))}`);
      if (Number(r.diambil) > 0) {
        await expect(li).toContainText(`Diambil Rp ${digits(Number(r.diambil))}`);
      } else {
        await expect(li).not.toContainText('Diambil');
      }
    }
    // Tanpa nama/id dompet di kartu (K1 S8).
    const html = await card.innerHTML();
    for (const w of [KAS, K9.n.wallet, K9.f.wallet]) expect(html.includes(w)).toBe(false);
  }
});

test('axe Laporan dan Rencana Bersama dua anggota (F) terang/gelap 320/390/768/1280', async ({
  partnerPage,
}) => {
  test.setTimeout(240_000);
  for (const theme of ['dark', 'light']) {
    for (const [w, h] of [
      [320, 640],
      [390, 844],
      [768, 1000],
      [1280, 800],
    ] as const) {
      await partnerPage.setViewportSize({ width: w, height: h });
      for (const url of [
        '/bersama/laporan',
        '/bersama/rencana',
        '/bersama/rencana?bagian=tagihan',
      ]) {
        await partnerPage.goto(`${url}${url.includes('?') ? '&' : '?'}theme=${theme}`);
        await expect(partnerPage.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(main(partnerPage)).toBeVisible();
        await expectNoSeriousViolations(partnerPage, { tags: WCAG_TAGS });
        await noHorizontalScroll(partnerPage);
      }
    }
  }
});

const BUDGET: [string, 'n' | 'f'][] = [
  ['/bersama/rencana', 'n'],
  ['/bersama/rencana?bagian=tagihan', 'f'],
  ['/bersama/laporan', 'n'],
  ['/bersama/laporan', 'f'],
  ['/pribadi/rencana', 'f'],
  ['/pribadi/laporan', 'f'],
];

for (const [url, who] of BUDGET) {
  test(`JS muat dingin ${who.toUpperCase()} ${url} dua anggota mode nyata ≤ 162 kB`, async ({
    browser,
    ownerState,
    partnerState,
  }) => {
    const kb = await expectRouteBudget(browser, who === 'n' ? ownerState : partnerState, url);
    console.log(`BUDGET-S9B ${who} ${url}: js-route ${kb.toFixed(1)} kB`);
  });
}
