import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations, WCAG_TAGS } from '../e2e/axe';
import { asUser, createWallet, noHorizontalScroll, spaceOf } from '../e2e-auth/helpers';
import { adminQuery } from '../e2e-ledger/fixtures';
import {
  bersamaResponses,
  chipsOf,
  digits,
  expectRouteBudget,
  openCatat,
  toasts,
  walletBalance,
} from '../e2e-ledger/helpers';
import { expect, test } from './fixtures';
import { OWNER, PARTNER } from './global-setup';

/**
 * Kriteria keluar S8 ujung ke ujung, dua user (Task 10): N dan F di dua `browserContext`.
 * Kanari Pribadi tidak pernah sampai ke Beranda/Aktivitas Bersama (HTML + payload RSC, muat dokumen,
 * muat ulang, navigasi klien) untuk kedua anggota; feed + Kontribusi tanpa nama/id dompet (K1);
 * setor N dan ambil F lewat Catat; pindah Bersama → Pribadi (R26); sebelum/sesudah dan konflik
 * versi dua anggota; B5; angka Kontribusi = jumlah setor/ambil bulan ini; keyboard saja; axe;
 * budget JS. Onboarding F (Pribadi baru) ada di `bergabung.spec.ts` (proyek yang jalan lebih dulu).
 * Satu urutan serial; data khas S8 sendiri, jadi bisa jalan sesudah `aktivitas.spec.ts`.
 */

test.describe.configure({ mode: 'serial' });

const KAS = 'Kas Bersama S8';
const SETOR = { amount: 1_250_000, description: 'KANARI-N-SETOR' };
const SETOR_BATAL = { amount: 400_000, description: 'KANARI-N-SETOR-BATAL' };
const AMBIL = { amount: 300_000, description: 'KANARI-F-AMBIL' };
const PINDAH = { amount: 85_000, description: 'PINDAH-S8-E2E' };
const UBAH = { amount: 50_000, after: 75_000, description: 'UBAH-S8-E2E' };
const STRESS = 12_345_678_900;
/** 40 karakter (batas `profiles.display_name` dan keterangan panjang di baris feed). */
const NAMA_40 = 'Farida Kusumawardhani Putri Ayuningtiyas';
const KET_40 = 'Belanja bulanan keluarga besar di pasar.';

const main = (page: Page) => page.getByRole('main');
const aktivitasCard = (page: Page) => main(page).getByRole('region', { name: /^Aktivitas/ });
const kontribusiCard = (page: Page) => main(page).getByRole('region', { name: /^Kontribusi / });
const feedRows = (page: Page) => main(page).getByRole('region').locator('li');
const rp = (n: number) => new RegExp(`Rp\\s${digits(n).replaceAll('.', '\\.')}(?!\\d|\\.\\d)`);

/** Fokus keyboard sampai `target` (Tab maju, maks `max` kali). */
async function tabTo(page: Page, target: Locator, max = 60): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

/** Dompet Bersama tes ini (idempoten: worker yang dimulai ulang memakai yang sudah ada). */
async function ensureKas(): Promise<void> {
  const { sid } = await spaceOf(OWNER, 'shared');
  const rows = await adminQuery('select 1 from app.accounts where space_id = $1 and name = $2', [
    sid,
    KAS,
  ]);
  if (rows.length === 0) await createWallet(OWNER, 'shared', KAS, 5_000_000);
}

/** Pilih jenis Transfer di sheet Catat yang terbuka (judul `Pengeluaran · {Ruang}`). */
async function toTransfer(page: Page, ruang: 'Pribadi' | 'Bersama'): Promise<Locator> {
  const expense = page.getByRole('dialog', { name: `Pengeluaran · ${ruang}` });
  await expense.getByRole('button', { name: `Pengeluaran · ${ruang}` }).click();
  await page.getByRole('menuitemradio', { name: 'Transfer' }).click();
  return page.getByRole('dialog', { name: `Transfer · ${ruang}` });
}

/** N setor dari dompet Pribadi `KANARI-DOMPET-N` ke `KAS` lewat Catat di `/pribadi`. */
async function setor(page: Page, wallet: string, s: { amount: number; description: string }) {
  await page.goto('/pribadi/beranda');
  await openCatat(page);
  let sheet = await toTransfer(page, 'Pribadi');
  await sheet.getByLabel('Dari dompet').selectOption({ label: wallet });
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill(String(s.amount));
  await sheet.getByRole('button', { name: /pilih dompet di ruang lain/ }).click();
  await page
    .getByRole('radiogroup', { name: 'Dompet di Bersama' })
    .getByRole('radio', { name: new RegExp(KAS) })
    .click();
  sheet = page.getByRole('dialog', { name: 'Transfer · Pribadi → Bersama' });
  await sheet.getByLabel(/Keterangan \(hanya di Pribadi\)/).fill(s.description);
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page).getByText(`Tersimpan di Pribadi · Rp ${digits(s.amount)} ke Bersama`),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);
}

/** F ambil dari `KAS` ke dompet Pribadinya lewat Catat di `/bersama` (B6). */
async function ambil(page: Page, wallet: string) {
  await page.goto('/bersama/beranda');
  await openCatat(page);
  let sheet = await toTransfer(page, 'Bersama');
  await sheet.getByLabel('Dari dompet').selectOption({ label: KAS });
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill(String(AMBIL.amount));
  await sheet.getByRole('button', { name: /pilih dompet di ruang lain/ }).click();
  await page
    .getByRole('radiogroup', { name: 'Dompet di Pribadi' })
    .getByRole('radio', { name: new RegExp(wallet) })
    .click();
  sheet = page.getByRole('dialog', { name: 'Transfer · Bersama → Pribadi' });
  await expect(sheet.getByRole('radio', { name: `${wallet} · Pribadi` })).toBeVisible();
  await sheet.getByLabel(/Keterangan \(hanya di Pribadi\)/).fill(AMBIL.description);
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page).getByText(`Tersimpan di Bersama · Rp ${digits(AMBIL.amount)} ke Pribadi`),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);
  // Toast tanpa nama dompet (batas ruang).
  await expect(toasts(page).getByText(new RegExp(`${wallet}|${KAS}`))).toHaveCount(0);
}

/** Pengeluaran Bersama dari `KAS` lewat Catat di `/bersama`. */
async function catatBersama(page: Page, amount: number, description: string) {
  await page.goto('/bersama/beranda');
  const sheet = await openCatat(page);
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill(String(amount));
  await sheet.getByLabel(/Keterangan/).fill(description);
  await sheet.getByLabel('Dari dompet').selectOption({ label: KAS });
  await chipsOf(sheet).first().click();
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page).getByText(`Tersimpan di Bersama · Rp ${digits(amount)} dari ${KAS}`),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);
}

async function entryId(description: string, kind: 'personal' | 'shared'): Promise<string> {
  const [row] = await adminQuery<{ id: string }>(
    'select id::text from app.entries where description = $1 and space_kind = $2::app.space_kind',
    [description, kind],
  );
  if (!row) throw new Error(`entri ${description} tidak ada`);
  return row.id;
}

/** Kaki Bersama transfer antar ruang yang kaki Pribadinya berketerangan `description`. */
async function bersamaLegOf(description: string): Promise<string> {
  const [row] = await adminQuery<{ id: string }>(
    `select b.id::text from app.entries p
       join app.entries b on b.link_id = p.link_id and b.space_kind = 'shared'
      where p.description = $1 and p.space_kind = 'personal'`,
    [description],
  );
  if (!row) throw new Error(`kaki Bersama ${description} tidak ada`);
  return row.id;
}

/**
 * Kanari Pribadi dari DB (superuser): teks kanari, nominal kanari, id dompet/entri/ruang Pribadi
 * siapa pun, dan `link_id` transfer antar ruang (penaut kedua kaki, tidak pernah ke Bersama).
 */
async function pribadiKanari(): Promise<string[]> {
  const ids = await adminQuery<{ id: string }>(
    `select id::text from app.entries where space_kind = 'personal'
     union select a.id::text from app.accounts a join app.spaces s on s.id = a.space_id
            where s.kind = 'personal'
     union select id::text from app.spaces where kind = 'personal'
     union select distinct link_id::text from app.entries where link_id is not null`,
  );
  const names = await adminQuery<{ name: string }>(
    `select a.name from app.accounts a join app.spaces s on s.id = a.space_id
      where s.kind = 'personal'`,
  );
  return [
    'KANARI',
    '7.777.777',
    '6.666.666',
    '7777777',
    '6666666',
    ...names.map((n) => n.name),
    ...ids.map((r) => r.id),
  ];
}

/** Nama dan id semua dompet (ruang mana pun): tidak boleh ada di markup feed/Kontribusi (K1). */
async function allWallets(): Promise<string[]> {
  const rows = await adminQuery<{ id: string; name: string }>(
    'select id::text, name from app.accounts',
  );
  return rows.flatMap((r) => [r.id, r.name]);
}

const paths = { setoranLeg: '', ambilLeg: '', moved: '', ubah: '' };

test.beforeAll(async () => {
  await ensureKas();
});

test(
  'F bergabung: Pribadi F terisolasi, Bersama berisi dua anggota',
  { tag: [] }, // ID: Task 11
  async ({ page, partnerPage, kanari }) => {
    // Kontrol positif: F terautentikasi di Pribadi-nya dan melihat kanari F, bukan kanari N.
    await partnerPage.goto('/pribadi/dompet');
    await expect(partnerPage).toHaveURL(/\/pribadi\/dompet$/);
    await expect(partnerPage.getByText(kanari.f.wallet)).toBeVisible();
    await expect(partnerPage.getByText(kanari.n.wallet)).toHaveCount(0);
    await partnerPage.goto('/pribadi/transaksi');
    await expect(partnerPage.getByText(kanari.f.description)).toBeVisible();
    await expect(partnerPage.getByText(kanari.n.description)).toHaveCount(0);

    // Bersama: F tetap di rute itu (tidak dialihkan) dan DB mencatat dua anggota ruang yang sama.
    await partnerPage.goto('/bersama/beranda');
    await expect(partnerPage).toHaveURL(/\/bersama\/beranda$/);
    await expect(partnerPage.getByRole('heading', { name: 'Beranda' })).toBeVisible();
    await expect(partnerPage.getByRole('link', { name: /Undang Farida/ })).toHaveCount(0);
    const { sid } = await spaceOf(PARTNER, 'shared');
    const members = await adminQuery<{ n: string }>(
      'select count(*)::text as n from app.space_members where space_id = $1',
      [sid],
    );
    expect(members[0]?.n).toBe('2');
    await page.goto('/undang');
    await expect(page.getByText('Ruang Bersama sudah berisi dua orang.')).toBeVisible();
  },
);

test(
  'kanari: setor N, ambil F lewat Catat Bersama, pindah ke Pribadi; feed N dan F tanpa Pribadi dan tanpa dompet',
  { tag: ['@B3', '@B4', '@B6', '@B20'] },
  async ({ page, partnerPage, kanari }) => {
    test.setTimeout(240_000);
    const n0 = await walletBalance(page, 'pribadi', kanari.n.wallet);
    const kas0 = await walletBalance(page, 'bersama', KAS);
    const f0 = await walletBalance(partnerPage, 'pribadi', kanari.f.wallet);

    await setor(page, kanari.n.wallet, SETOR);
    await ambil(partnerPage, kanari.f.wallet);
    // B3/B6: kedua ruang bergerak sebesar transfer; Σ tetap.
    expect(await walletBalance(page, 'pribadi', kanari.n.wallet)).toBe(n0 - SETOR.amount);
    expect(await walletBalance(partnerPage, 'pribadi', kanari.f.wallet)).toBe(f0 + AMBIL.amount);
    expect(await walletBalance(page, 'bersama', KAS)).toBe(kas0 + SETOR.amount - AMBIL.amount);
    paths.setoranLeg = `/bersama/transaksi/${await bersamaLegOf(SETOR.description)}`;
    paths.ambilLeg = `/bersama/transaksi/${await bersamaLegOf(AMBIL.description)}`;

    // N memindahkan pengeluaran Bersama ke Pribadi (dompet kanari N).
    await catatBersama(page, PINDAH.amount, PINDAH.description);
    const movedId = await entryId(PINDAH.description, 'shared');
    paths.moved = `/bersama/transaksi/${movedId}`;
    await page.goto(paths.moved);
    const move = main(page).getByRole('button', { name: 'Pindahkan ke Pribadi' });
    const moveSheet = page.getByRole('dialog', { name: 'Pindahkan ke Pribadi' });
    await expect(async () => {
      if ((await moveSheet.count()) === 0) await move.click();
      await expect(moveSheet.getByLabel('Dompet di Pribadi')).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await moveSheet.getByLabel('Dompet di Pribadi').selectOption({ label: kanari.n.wallet });
    const chip = chipsOf(moveSheet).first();
    if ((await chip.getAttribute('aria-checked')) !== 'true') await chip.click();
    await moveSheet.getByRole('button', { name: 'Lanjut' }).click();
    await page
      .getByRole('alertdialog', { name: 'Pindahkan ke Pribadi?' })
      .getByRole('button', { name: 'Pindahkan' })
      .click();
    await expect(page).toHaveURL(/\/pribadi\/transaksi$/);
    const [origin] = await adminQuery<{ moved: boolean }>(
      'select moved_at is not null as moved from app.entries where id = $1',
      [movedId],
    );
    expect(origin?.moved).toBe(true);

    // Kanari benar-benar ada di DB Pribadi (tes tidak lulus karena data kosong).
    for (const d of [SETOR.description, AMBIL.description, kanari.n.description]) {
      await entryId(d, 'personal');
    }
    const kanariAll = await pribadiKanari();
    expect(kanariAll.length).toBeGreaterThan(10);
    const wallets = await allWallets();

    const expectNoKanari = (who: string, r: { bodies: string[]; unread: string[] }) => {
      expect(r.unread, who).toEqual([]);
      expect(r.bodies.length, who).toBeGreaterThan(0);
      for (const body of r.bodies)
        for (const k of kanariAll) expect(body.includes(k), `${who}: ${k}`).toBe(false);
    };
    /** K1: markup kartu feed dan Kontribusi (termasuk atribut) tanpa nama atau id dompet mana pun. */
    const expectNoWallet = async (who: string, cards: Locator[]) => {
      for (const card of cards) {
        await expect(card).toBeVisible();
        const html = await card.innerHTML();
        for (const w of wallets) expect(html.includes(w), `${who} K1: ${w}`).toBe(false);
      }
    };

    for (const [who, p] of [
      ['N', page],
      ['F', partnerPage],
    ] as const) {
      // Muat dokumen + muat ulang, kedua rute.
      for (const path of ['/bersama/beranda', '/bersama/aktivitas']) {
        const doc = await bersamaResponses(p, () => p.goto(path));
        expectNoKanari(`${who} ${path}`, doc);
        // Kontrol positif: dokumen memuat feed yang diperiksa (R26 dan setor/ambil).
        const html = doc.bodies.join('\n');
        expect(html, `${who} ${path}`).toContain('memindahkan transaksi ke ruang lain');
        expect(html, `${who} ${path}`).toContain('menyetor ke Bersama');
        expect(html, `${who} ${path}`).toContain('mengambil dari Bersama');
        const reload = await bersamaResponses(p, () => p.reload());
        expectNoKanari(`${who} ${path} reload`, reload);
        expect(reload.bodies.join('\n'), `${who} ${path} reload`).toContain(
          'memindahkan transaksi ke ruang lain',
        );
      }
      // Navigasi klien Beranda → Semua → Aktivitas → Beranda (payload RSC navigasi).
      await p.goto('/bersama/beranda');
      await expect(aktivitasCard(p)).toBeVisible();
      const nav = await bersamaResponses(p, async () => {
        await aktivitasCard(p).getByRole('link', { name: 'Semua aktivitas Bersama' }).click();
        await expect(p).toHaveURL(/\/bersama\/aktivitas$/);
        await expect(feedRows(p).first()).toBeVisible();
        await main(p)
          .getByRole('link', { name: /Beranda/ })
          .first()
          .click();
        await expect(p).toHaveURL(/\/bersama\/beranda$/);
        await expect(aktivitasCard(p)).toBeVisible();
      });
      expectNoKanari(`${who} navigasi klien`, nav);
      expect(nav.bodies.some((b) => b.includes('memindahkan transaksi ke ruang lain'))).toBe(true);

      // Isi feed Beranda: urutan terbaru di atas, pelaku dengan nama roster, nominal tanpa dompet.
      const rows = aktivitasCard(p).getByRole('listitem');
      expect(await rows.count()).toBeGreaterThanOrEqual(4);
      await expect(rows.nth(0)).toContainText(/Novanda\s·\smemindahkan transaksi ke ruang lain/);
      await expect(rows.nth(0)).toContainText(rp(PINDAH.amount));
      await expect(rows.nth(1)).toContainText(
        new RegExp(`Novanda\\s·\\smencatat pengeluaran ${PINDAH.description}`),
      );
      await expect(rows.nth(2)).toContainText(/Farida\s·\smengambil dari Bersama/);
      await expect(rows.nth(2)).toContainText(rp(AMBIL.amount));
      await expect(rows.nth(3)).toContainText(/Novanda\s·\smenyetor ke Bersama/);
      await expect(rows.nth(3)).toContainText(rp(SETOR.amount));
      await expectNoWallet(who, [aktivitasCard(p), kontribusiCard(p)]);
      await p.goto('/bersama/aktivitas');
      await expect(feedRows(p).first()).toBeVisible();
      await expectNoWallet(who, [main(p)]);
    }

    // Baris R26 menaut ke Detail entri asal; F melihat banner tanpa ruang tujuan dan tanpa tautan.
    await partnerPage.goto('/bersama/beranda');
    await aktivitasCard(partnerPage)
      .getByRole('link', { name: /memindahkan transaksi ke ruang lain/ })
      .click();
    await expect(partnerPage).toHaveURL(new RegExp(`${paths.moved}$`));
    await expect(
      main(partnerPage).getByText('Novanda memindahkan transaksi ini ke ruang lain.'),
    ).toBeVisible();
    await expect(main(partnerPage).getByRole('link', { name: /Buka di/ })).toHaveCount(0);
    expectNoKanari(
      'F Detail dipindah',
      await bersamaResponses(partnerPage, () => partnerPage.reload()),
    );
  },
);

test(
  'sebelum/sesudah: F mengubah 50.000 → 75.000 (N konflik), F membatalkan, N memulihkan',
  { tag: ['@B8', '@B20'] },
  async ({ page, partnerPage }) => {
    test.setTimeout(180_000);
    await catatBersama(page, UBAH.amount, UBAH.description);
    const id = await entryId(UBAH.description, 'shared');
    paths.ubah = `/bersama/transaksi/${id}`;
    const n = await spaceOf(OWNER, 'shared');
    const f = await spaceOf(PARTNER, 'shared');

    // Beranda N terbuka sebelum perubahan; Detail N di tab kedua dengan sheet Ubah versi 1.
    await page.goto('/bersama/beranda');
    await expect(aktivitasCard(page).getByRole('listitem').first()).toContainText(
      new RegExp(`Novanda\\s·\\smencatat pengeluaran ${UBAH.description}`),
    );
    const nDetail = await page.context().newPage();
    for (const p of [nDetail, partnerPage]) {
      await p.goto(paths.ubah);
      const nominal = p
        .getByRole('dialog', { name: 'Ubah transaksi' })
        .getByRole('textbox', { name: 'Nominal' });
      await expect(async () => {
        if ((await nominal.count()) === 0) {
          await main(p).getByRole('button', { name: 'Ubah' }).click();
        }
        await expect(nominal).toHaveValue(digits(UBAH.amount), { timeout: 1_000 });
      }).toPass();
    }
    const fSheet = partnerPage.getByRole('dialog', { name: 'Ubah transaksi' });
    await fSheet.getByRole('textbox', { name: 'Nominal' }).fill(String(UBAH.after));
    await fSheet.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect(fSheet).toHaveCount(0);

    // B8: versi sama, N kalah; pesan menyebut F dan nilai lama → baru.
    const nSheet = nDetail.getByRole('dialog', { name: 'Ubah transaksi' });
    await nSheet.getByRole('textbox', { name: 'Nominal' }).fill('60000');
    await nSheet.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect(nSheet.getByRole('alert')).toHaveText(
      /^Farida mengubah transaksi ini .+ \(Rp\s50\.000 → Rp\s75\.000\)\. Muat versi terbaru untuk melanjutkan\.$/,
    );
    await nDetail.close();
    const history = await adminQuery<{ version: number; by: string }>(
      'select version, changed_by::text as by from app.entry_history where entry_id = $1 order by version',
      [id],
    );
    expect(history).toEqual([
      { version: 1, by: n.uid },
      { version: 2, by: f.uid },
    ]);

    // Satu muat ulang Beranda N cukup: baris perubahan F di atas, nominal kanan kosong.
    await page.reload();
    const top = aktivitasCard(page).getByRole('listitem').first();
    await expect(top).toContainText(new RegExp(`Farida\\s·\\smengubah ${UBAH.description}`));
    await expect(top).toContainText(/Rp\s50\.000 → Rp\s75\.000/);
    await expect(top.locator('.sr-only')).toHaveText('dari Rp 50.000 menjadi Rp 75.000');

    // F membatalkan dari Detail; N memulihkan dari Sampah Bersama.
    await partnerPage.goto(paths.ubah);
    await main(partnerPage).getByRole('button', { name: 'Batalkan transaksi' }).click();
    await partnerPage
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Batalkan transaksi' })
      .click();
    await expect(partnerPage).toHaveURL(/\/bersama\/transaksi$/);
    await page.goto('/bersama/sampah');
    const trashRow = main(page).getByRole('listitem').filter({ hasText: UBAH.description });
    await trashRow
      .getByRole('button', { name: new RegExp(`^Pulihkan ${UBAH.description}`) })
      .click();
    await expect(toasts(page).getByText('Dipulihkan di Bersama · Rp 75.000')).toBeVisible();

    // Urutan dan pelaku di halaman Aktivitas, sama bagi N dan F.
    for (const p of [page, partnerPage]) {
      await p.goto('/bersama/aktivitas');
      const rows = feedRows(p).filter({ hasText: UBAH.description });
      await expect(rows).toHaveCount(4);
      await expect(rows.nth(0)).toContainText(
        new RegExp(`Novanda\\s·\\smemulihkan pengeluaran ${UBAH.description}`),
      );
      await expect(rows.nth(0)).toContainText(rp(UBAH.after));
      await expect(rows.nth(1)).toContainText(
        new RegExp(`Farida\\s·\\smembatalkan pengeluaran ${UBAH.description}`),
      );
      await expect(rows.nth(2)).toContainText(
        new RegExp(`Farida\\s·\\smengubah ${UBAH.description}`),
      );
      await expect(rows.nth(2)).toContainText(/Rp\s50\.000 → Rp\s75\.000/);
      await expect(rows.nth(3)).toContainText(
        new RegExp(`Novanda\\s·\\smencatat pengeluaran ${UBAH.description}`),
      );
      await expect(rows.nth(3)).toContainText(rp(UBAH.amount));
    }
  },
);

test(
  'B5: F membuka Detail setoran N tanpa Batalkan; N membuka pengambilan F tanpa Batalkan',
  { tag: ['@B5'] },
  async ({ page, partnerPage }) => {
    expect(paths.setoranLeg).not.toBe('');
    // F lewat baris feed (jalur nyata), N lewat URL yang sama sebagai kontrol positif.
    await partnerPage.goto('/bersama/aktivitas');
    await feedRows(partnerPage)
      .filter({ hasText: /Novanda\s·\smenyetor ke Bersama/ })
      .first()
      .getByRole('link')
      .click();
    await expect(partnerPage).toHaveURL(new RegExp(`${paths.setoranLeg}$`));
    await expect(
      main(partnerPage)
        .getByText(/Setoran dari Novanda/)
        .first(),
    ).toBeVisible();
    await expect(main(partnerPage).getByRole('button', { name: /Batalkan/ })).toHaveCount(0);
    await expect(main(partnerPage).getByRole('button', { name: 'Ubah' })).toHaveCount(0);
    await expect(
      main(partnerPage).getByText('Hanya Novanda yang bisa membatalkan transfer ini.'),
    ).toBeVisible();
    await page.goto(paths.setoranLeg);
    await expect(main(page).getByRole('button', { name: 'Batalkan transaksi' })).toBeVisible();

    // Simetris: pengambilan F hanya bisa dibatalkan F.
    await page.goto(paths.ambilLeg);
    await expect(
      main(page)
        .getByText(/Diambil oleh Farida/)
        .first(),
    ).toBeVisible();
    await expect(main(page).getByRole('button', { name: /Batalkan/ })).toHaveCount(0);
    await expect(
      main(page).getByText('Hanya Farida yang bisa membatalkan transfer ini.'),
    ).toBeVisible();
    await partnerPage.goto(paths.ambilLeg);
    await expect(
      main(partnerPage).getByRole('button', { name: 'Batalkan transaksi' }),
    ).toBeVisible();
  },
);

/** Angka per anggota dari DB (tanpa fungsi Kontribusi): kaki Bersama hidup bulan WIB ini. */
async function contributionsFromDb(): Promise<Record<string, { in: number; out: number }>> {
  const { sid } = await spaceOf(OWNER, 'shared');
  const rows = await adminQuery<{ name: string; dir: string; total: string }>(
    `select p.display_name as name, e.direction::text as dir, sum(abs(l.amount))::text as total
       from app.entries e
       join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
       join app.profiles p on p.user_id = e.created_by
      where e.space_id = $1 and e.kind = 'space_transfer' and e.voided_at is null
        and date_trunc('month', e.occurred_on)
            = date_trunc('month', (now() at time zone 'Asia/Jakarta')::date)
      group by 1, 2`,
    [sid],
  );
  const out: Record<string, { in: number; out: number }> = {
    Novanda: { in: 0, out: 0 },
    Farida: { in: 0, out: 0 },
  };
  for (const r of rows) {
    const m = (out[r.name] ??= { in: 0, out: 0 });
    m[r.dir === 'in' ? 'in' : 'out'] = Number(r.total);
  }
  return out;
}

/** Nilai `Setor`/`Diambil` satu anggota di kartu Kontribusi (`null` = baris tidak ada). */
async function cardValues(page: Page, name: string) {
  const li = kontribusiCard(page).getByRole('listitem').filter({ hasText: name });
  await expect(li).toHaveCount(1);
  const value = async (term: string) => {
    const dd = li.locator('dt', { hasText: term }).locator('xpath=following-sibling::dd');
    if ((await dd.count()) === 0) return null;
    // MoneyText bisa merender nominal dua kali (tampil + sr-only): ambil nominal pertama.
    const m = /Rp\s?([\d.]+)/.exec(await dd.innerText());
    if (!m?.[1]) throw new Error(`${name} ${term}: nominal tidak terbaca`);
    return Number(m[1].replaceAll('.', ''));
  };
  return { setor: await value('Setor'), diambil: await value('Diambil') };
}

test(
  'Kontribusi = jumlah setor/ambil per orang bulan ini; setoran batal hilang sesudah muat ulang',
  { tag: ['@B3', '@B6'] },
  async ({ page, partnerPage, kanari }) => {
    test.setTimeout(180_000);
    const expectCard = async (p: Page, setorN: number) => {
      const db = await contributionsFromDb();
      expect(db).toEqual({
        Novanda: { in: setorN, out: 0 },
        Farida: { in: 0, out: AMBIL.amount },
      });
      await expect(kontribusiCard(p)).toContainText(/^Kontribusi \S+/);
      // Urutan tetap: pemilik lalu anggota, sama bagi kedua pembaca.
      const items = kontribusiCard(p).getByRole('listitem');
      await expect(items).toHaveCount(2);
      await expect(items.nth(0)).toContainText('Novanda');
      await expect(items.nth(1)).toContainText('Farida');
      expect(await cardValues(p, 'Novanda')).toEqual({ setor: db.Novanda?.in, diambil: null });
      expect(await cardValues(p, 'Farida')).toEqual({ setor: 0, diambil: db.Farida?.out });
    };
    for (const p of [page, partnerPage]) {
      await p.goto('/bersama/beranda');
      await expectCard(p, SETOR.amount);
    }

    await setor(page, kanari.n.wallet, SETOR_BATAL);
    await partnerPage.reload();
    await expectCard(partnerPage, SETOR.amount + SETOR_BATAL.amount);

    // N membatalkan setoran kedua dari kaki Bersama; F memuat ulang sekali.
    await page.goto(`/bersama/transaksi/${await bersamaLegOf(SETOR_BATAL.description)}`);
    await main(page).getByRole('button', { name: 'Batalkan transaksi' }).click();
    await page
      .getByRole('alertdialog', { name: 'Batalkan transfer antar ruang?' })
      .getByRole('button', { name: 'Batalkan transfer' })
      .click();
    await expect(page).toHaveURL(/\/bersama\/transaksi$/);
    await partnerPage.reload();
    await expectCard(partnerPage, SETOR.amount);
    await expect(aktivitasCard(partnerPage).getByRole('listitem').first()).toContainText(
      /Novanda\s·\smembatalkan setoran ke Bersama/,
    );
    await page.goto('/bersama/beranda');
    await expectCard(page, SETOR.amount);
  },
);

test('keyboard saja: Beranda Bersama → Semua → Muat sebelumnya → Kembali ke terbaru', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Halaman Aktivitas butuh > 30 peristiwa agar `Muat sebelumnya` ada (berkas ini bisa jalan sendiri).
  const { uid, sid } = await spaceOf(OWNER, 'shared');
  const [count] = await adminQuery<{ n: number }>(
    `select count(*)::int as n from app.entry_history h join app.entries e on e.id = h.entry_id
      where e.space_id = $1 and e.kind <> 'opening_balance'`,
    [sid],
  );
  const [ids] = await asUser<{ acc: string; cat: string }>(
    uid,
    `select (select id::text from app.accounts where space_id = $1 and name = $2) as acc,
            (select id::text from app.categories where space_id = $1 and type = 'expense'
              and parent_id is null order by sort_order limit 1) as cat`,
    [sid, KAS],
  );
  if (!ids) throw new Error('dompet/kategori tidak ada');
  for (let i = count?.n ?? 0; i <= 31; i++) {
    await asUser(
      uid,
      `select api.create_entry(p_client_id => $1, p_space_id => $2, p_account_id => $3,
         p_kind => 'expense', p_amount => 1000::bigint, p_category_id => $4,
         p_description => $5)`,
      [randomUUID(), sid, ids.acc, ids.cat, `Isi aktivitas ${String(i)}`],
    );
  }

  await page.goto('/bersama/beranda');
  await expect(aktivitasCard(page)).toBeVisible();
  const semua = aktivitasCard(page).getByRole('link', { name: 'Semua aktivitas Bersama' });
  await tabTo(page, semua);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/bersama\/aktivitas$/);
  await expect(feedRows(page)).toHaveCount(30);
  const more = main(page).getByRole('link', { name: 'Muat sebelumnya' });
  await tabTo(page, more, 120);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/bersama\/aktivitas\?sebelum=/);
  await expect(feedRows(page).first()).toBeVisible();
  const back = main(page).getByRole('link', { name: 'Kembali ke terbaru' });
  await tabTo(page, back, 80);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/bersama\/aktivitas$/);
  await expect(feedRows(page)).toHaveCount(30);
});

test('axe 0 serious/critical terang + gelap 320/390/1280; 320 tanpa gulir horizontal dengan nominal 12 digit dan nama 40 karakter', async ({
  page,
  partnerPage,
}) => {
  test.setTimeout(480_000);
  expect(NAMA_40).toHaveLength(40);
  expect(KET_40).toHaveLength(40);
  const { uid, sid } = await spaceOf(OWNER, 'shared');
  const f = await spaceOf(PARTNER, 'shared');
  const [ids] = await asUser<{ acc: string; cat: string }>(
    uid,
    `select (select id::text from app.accounts where space_id = $1 and name = $2) as acc,
            (select id::text from app.categories where space_id = $1 and type = 'expense'
              and parent_id is null order by sort_order limit 1) as cat`,
    [sid, KAS],
  );
  if (!ids) throw new Error('dompet/kategori tidak ada');
  // F mencatat nominal 12 digit dengan keterangan 40 karakter (baris feed teratas).
  await asUser(
    f.uid,
    `select api.create_entry(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_kind => 'expense', p_amount => $4::bigint, p_category_id => $5, p_description => $6,
       p_allow_negative => true)`,
    [randomUUID(), sid, ids.acc, STRESS, ids.cat, KET_40],
  );
  // Nama tampilan F 40 karakter (batas profil) selama tes ini; nilai asli dikembalikan sesudahnya.
  const [asli] = await adminQuery<{ name: string }>(
    'select display_name as name from app.profiles where user_id = $1',
    [f.uid],
  );
  if (!asli) throw new Error('profil F tidak ada');
  await adminQuery('update app.profiles set display_name = $2 where user_id = $1', [
    f.uid,
    NAMA_40,
  ]);
  try {
    const screens: { p: Page; path: string; ready: (p: Page) => Locator }[] = [
      { p: page, path: '/bersama/beranda', ready: (p) => kontribusiCard(p) },
      { p: page, path: '/bersama/aktivitas', ready: (p) => feedRows(p).first() },
      {
        p: partnerPage,
        path: '/pribadi/beranda',
        ready: (p) => main(p).getByRole('heading', { name: 'Beranda' }),
      },
    ];
    for (const theme of ['dark', 'light'] as const) {
      for (const width of [320, 390, 1280]) {
        for (const s of screens) {
          await s.p.setViewportSize({ width, height: 800 });
          await s.p.goto(`${s.path}?theme=${theme}`);
          await expect(s.p.locator('html')).toHaveAttribute('data-theme', theme);
          await expect(s.ready(s.p).first()).toBeVisible();
          if (s.p === page) {
            // Data tekanan benar-benar tampil di layar yang diperiksa.
            await expect(main(page).getByText(NAMA_40).first()).toBeVisible();
            await expect(main(page).getByText(rp(STRESS)).first()).toBeVisible();
          }
          await expectNoSeriousViolations(s.p, { tags: WCAG_TAGS });
          if (width === 320) await noHorizontalScroll(s.p);
        }
      }
    }
  } finally {
    await adminQuery('update app.profiles set display_name = $2 where user_id = $1', [
      f.uid,
      asli.name,
    ]);
  }
});

const BUDGET: [string, 'n' | 'f', () => string][] = [
  ['N /bersama/beranda dua anggota', 'n', () => '/bersama/beranda'],
  ['N /bersama/aktivitas', 'n', () => '/bersama/aktivitas'],
  ['N /bersama/transaksi/[id] setoran', 'n', () => paths.setoranLeg],
  ['F /bersama/beranda', 'f', () => '/bersama/beranda'],
  ['F /bersama/aktivitas', 'f', () => '/bersama/aktivitas'],
  ['F /bersama/transaksi/[id] dipindah', 'f', () => paths.moved],
  ['F /pribadi/beranda', 'f', () => '/pribadi/beranda'],
];

for (const [name, who, url] of BUDGET) {
  test(`JS muat dingin ${name} mode nyata ≤ 162 kB`, async ({
    browser,
    ownerState,
    partnerState,
  }) => {
    expect(url()).not.toBe('');
    const kb = await expectRouteBudget(browser, who === 'n' ? ownerState : partnerState, url());
    console.log(`BUDGET-S8 ${name}: js-route ${kb.toFixed(1)} kB`);
  });
}
