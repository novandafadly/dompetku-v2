import type { Page } from '@playwright/test';
import { expectNoSeriousViolations } from '../e2e/axe';
import { noHorizontalScroll } from '../e2e-auth/helpers';
import { adminQuery, expect, test } from './fixtures';
import {
  addWallet,
  bersamaResponses,
  catatSheet,
  digits,
  expectRouteBudget,
  openCatat,
  spaceId,
  toasts,
} from './helpers';

/**
 * S13 Task 4 mode nyata: Rencana > Tujuan. Tambah tujuan (dompet tabungan, tanggal target), progres
 * dan `Perlu Rp …/bulan` bergeser oleh transfer dan Urungkan, tujuan kedua pada dompet sama tidak
 * tersedia (dan `goal_exists` dari jalur server bila tab lain mendahului), Tercapai + Selesaikan,
 * tujuan baru di dompet yang sama, Pulihkan terhalang, Ubah, Arsipkan + Urungkan, Bersama, angka
 * uang lain tidak berubah (I6), segmen empat item di 320 px, axe, dan budget JS. Spec ini MENGISI
 * data dan tidak membersihkannya: project `data` (`playwright.ledger.config.ts`). Satu urutan serial.
 */
test.describe.configure({ mode: 'serial' });

const main = (page: Page) => page.getByRole('main');
const SUMBER = 'Dompet Sumber Tujuan';
const TAB = 'Tabungan Tujuan E2E';
const TAB_B = 'Tabungan Bersama Tujuan';
const G1 = 'Dana darurat E2E';
const G2 = 'Tujuan baru E2E';
const LONG = 'Liburan keluarga besar ke luar negeri tahun depan bersama saudara';
const NAME60 = LONG.slice(0, 60);
const rpRe = (n: number) => new RegExp(`Rp\\s${digits(n).replaceAll('.', '\\.')}`);

/** Tanggal ISO `days` hari dari sekarang (zona WIB tidak penting untuk target jauh). */
function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
const TARGET_ON = inDays(200);

async function addSavings(page: Page, ruang: 'pribadi' | 'bersama', name: string) {
  await page.goto(`/${ruang}/dompet?tambah=1`);
  const sheet = page.getByRole('dialog', { name: /Tambah dompet/ });
  await sheet.getByRole('textbox', { name: 'Nama' }).fill(name);
  await sheet.getByRole('radio', { name: 'Tabungan' }).click();
  await sheet.getByRole('button', { name: 'Simpan dompet' }).click();
  await expect(toasts(page).getByText(new RegExp(`Dompet ${name} ditambahkan`))).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function transfer(page: Page, from: string, to: string, amount: number) {
  await page.goto('/pribadi/beranda');
  await openCatat(page);
  const expense = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
  await expense.getByRole('button', { name: 'Pengeluaran · Pribadi' }).click();
  await page.getByRole('menuitemradio', { name: 'Transfer' }).click();
  const sheet = page.getByRole('dialog', { name: 'Transfer · Pribadi' });
  await sheet.getByLabel('Dari dompet').selectOption({ label: from });
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill(String(amount));
  await sheet
    .getByRole('radiogroup', { name: 'Ke dompet' })
    .getByRole('radio', { name: new RegExp(to) })
    .click();
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page)
      .getByText(/Tersimpan di Pribadi/)
      .last(),
  ).toBeVisible();
  await expect(catatSheet(page)).toHaveCount(0);
}

const tujuanUrl = (ruang: 'pribadi' | 'bersama') => `/${ruang}/rencana?bagian=tujuan`;
const card = (page: Page, name: string) => main(page).getByRole('region', { name, exact: true });

async function openAdd(page: Page) {
  const sheet = page.getByRole('dialog', { name: /^Tambah tujuan/ });
  await expect(async () => {
    if ((await sheet.count()) === 0) {
      await main(page).getByRole('button', { name: 'Tambah tujuan' }).first().click();
    }
    await expect(sheet.getByRole('textbox', { name: /Nama tujuan/ })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  return sheet;
}

async function fillGoal(
  sheet: ReturnType<Page['locator']>,
  name: string,
  target: number,
  date?: string,
) {
  await sheet.getByRole('textbox', { name: /Nama tujuan/ }).fill(name);
  await sheet.getByRole('textbox', { name: /Target/ }).fill(String(target));
  if (date !== undefined) await sheet.getByLabel(/Tanggal target/).fill(date);
}

/** Σ income dan expense hidup di Pribadi (kebenaran SQL; tujuan tidak boleh menggesernya). */
async function incomeExpense(): Promise<{ inc: number; exp: number }> {
  const [r] = await adminQuery<{ inc: string; exp: string }>(
    `select coalesce(sum(l.amount) filter (where e.kind = 'income'), 0)::text as inc,
            coalesce(sum(l.amount) filter (where e.kind = 'expense'), 0)::text as exp
       from app.entries e join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
      where e.space_id = $1 and e.voided_at is null`,
    [await spaceId('personal')],
  );
  if (!r) throw new Error('incomeExpense');
  return { inc: Number(r.inc), exp: Number(r.exp) };
}

async function balanceOf(name: string): Promise<number> {
  const [r] = await adminQuery<{ b: string }>(
    `select b.balance::text as b from app.accounts a
       join app.account_balances b on b.account_id = a.id where a.name = $1`,
    [name],
  );
  return Number(r?.b);
}

async function goalRows(name: string) {
  return adminQuery<{ status: string; target_on: string | null }>(
    `select status, target_on::text from app.goals where name = $1 order by created_at`,
    [name],
  );
}

/** Angka dari kalimat `Perlu Rp …` pada kartu (hanya untuk membandingkan dua keadaan). */
async function perluOf(page: Page, name: string): Promise<number> {
  const text = (await card(page, name).textContent()) ?? '';
  const m = /Perlu Rp\s?([\d.]+)/.exec(text);
  if (!m?.[1]) throw new Error('kalimat Perlu tidak ada');
  return Number(m[1].replaceAll('.', ''));
}

const base = { inc: 0, exp: 0 };

test('siapkan dompet; segmen Tujuan ada di Rencana; kosong tanpa dompet tabungan', async ({
  page,
}) => {
  await addWallet(page, 'pribadi', SUMBER, 30_000_000);
  await page.goto(tujuanUrl('pribadi'));
  await expect(
    main(page).getByRole('heading', { name: 'Belum ada dompet tabungan.' }),
  ).toBeVisible();
  await expect(main(page).getByRole('link', { name: 'Tambah dompet tabungan' })).toHaveAttribute(
    'href',
    /\/pribadi\/dompet\?tambah=1/,
  );
  const nav = page.getByRole('navigation', { name: 'Bagian Rencana' });
  await expect(nav.getByRole('link')).toHaveText(['Anggaran', 'Tagihan', 'Tujuan', 'Utang']);
  await expect(nav.getByRole('link', { name: 'Tujuan' })).toHaveAttribute('aria-current', 'page');
  await addSavings(page, 'pribadi', TAB);
  base.inc = (await incomeExpense()).inc;
  base.exp = (await incomeExpense()).exp;
});

test(
  'Tambah tujuan; tab lain yang mendahului membuat goal_exists di kolom Dompet',
  { tag: ['@T11'] },
  async ({ page, context }) => {
    await page.goto(tujuanUrl('pribadi'));
    await expect(main(page).getByRole('heading', { name: 'Belum ada tujuan.' })).toBeVisible();
    const sheetA = await openAdd(page);
    await expect(sheetA.getByRole('combobox', { name: 'Dompet tabungan' })).toHaveValue(/.+/);
    await fillGoal(sheetA, 'Tujuan kalah balapan', 3_000_000);

    // Tab lain membuat tujuan pada dompet yang sama lebih dulu.
    const other = await context.newPage();
    await other.goto(tujuanUrl('pribadi'));
    const sheetB = await openAdd(other);
    await fillGoal(sheetB, G1, 10_000_000, TARGET_ON);
    await sheetB.getByRole('button', { name: 'Simpan tujuan' }).click();
    await expect(toasts(other).getByText(`Tujuan ${G1} dibuat di Pribadi`)).toBeVisible();
    await expect(other.getByRole('dialog')).toHaveCount(0);
    await other.close();

    await sheetA.getByRole('button', { name: 'Simpan tujuan' }).click();
    await expect(
      sheetA.getByText(
        `${TAB} sudah punya tujuan aktif. Selesaikan atau arsipkan tujuan itu dulu.`,
      ),
    ).toBeVisible();
    await expect(toasts(page).getByText(/dibuat di/)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    expect(await goalRows(G1)).toEqual([{ status: 'active', target_on: TARGET_ON }]);
    expect(await goalRows('Tujuan kalah balapan')).toEqual([]);
  },
);

test('kartu kosong: Belum ada yang terkumpul tanpa Rp 0; semua dompet bertujuan: tanpa Tambah tujuan', async ({
  page,
}) => {
  await page.goto(tujuanUrl('pribadi'));
  const c = card(page, G1);
  await expect(c).toContainText('Belum ada yang terkumpul');
  await expect(c).toContainText(`Target Rp ${digits(10_000_000)}`);
  await expect(c).toContainText(`Isi lewat Transfer ke ${TAB}.`);
  await expect(c).toContainText('0%');
  await expect(c).not.toContainText(/Rp\s0(?![.\d])/);
  await expect(c).toContainText(/Perlu Rp\s[\d.]+\/bulan sampai/);
  await expect(c).toContainText('Dihitung per periode gajian');
  const bar = c.getByRole('progressbar', { name: G1 });
  await expect(bar).toHaveAttribute('aria-valuenow', '0');
  await expect(main(page).getByRole('button', { name: 'Tambah tujuan' })).toHaveCount(0);
  await expect(main(page).getByText(/Semua dompet tabungan sudah punya tujuan/)).toBeVisible();
});

test(
  'transfer menggeser progres dan Perlu; Urungkan mengembalikannya; I6 tetap',
  { tag: ['@T11'] },
  async ({ page }) => {
    await page.goto(tujuanUrl('pribadi'));
    const perluNol = await perluOf(page, G1);

    await transfer(page, SUMBER, TAB, 4_000_000);
    await page.goto(tujuanUrl('pribadi'));
    let c = card(page, G1);
    await expect(c).toContainText(rpRe(4_000_000));
    await expect(c).toContainText('40%');
    await expect(c).toContainText(`Sisa Rp ${digits(6_000_000)}`);
    await expect(c.getByRole('progressbar', { name: G1 })).toHaveAttribute('aria-valuenow', '40');
    expect(await perluOf(page, G1)).toBeLessThan(perluNol);

    // Urungkan dari toast Transfer: progres kembali ke nol.
    await transfer(page, SUMBER, TAB, 1_000_000);
    await toasts(page).getByRole('button', { name: 'Urungkan' }).click();
    await expect.poll(() => balanceOf(TAB)).toBe(4_000_000);
    await page.goto(tujuanUrl('pribadi'));
    c = card(page, G1);
    await expect(c).toContainText('40%');
    await expect(c).toContainText(`Sisa Rp ${digits(6_000_000)}`);

    const now = await incomeExpense();
    expect(now).toEqual(base);
  },
);

test(
  'Tercapai: Selesaikan tujuan memakai dialog; kartu pindah ke Selesai dan diarsipkan; Urungkan memulihkan',
  { tag: ['@T11'] },
  async ({ page }) => {
    await transfer(page, SUMBER, TAB, 6_500_000);
    await page.goto(tujuanUrl('pribadi'));
    const c = card(page, G1);
    await expect(c).toContainText('Tercapai');
    await expect(c).toContainText('100%');
    await expect(c).toContainText(`Selesaikan supaya ${TAB} bisa dipakai untuk tujuan baru.`);
    await expect(c).not.toContainText('Sisa');
    await expect(c.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');

    const finish = c.getByRole('button', { name: `Selesaikan tujuan ${G1}` });
    const dialog = page.getByRole('alertdialog', { name: `Selesaikan ${G1}?` });
    await expect(async () => {
      if ((await dialog.count()) === 0) await finish.click();
      await expect(dialog).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await expect(dialog.getByRole('button', { name: 'Kembali' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Selesaikan', exact: true }).click();
    await expect(toasts(page).getByText(`Tujuan ${G1} selesai`)).toBeVisible();
    await expect(card(page, G1)).toHaveCount(0);
    expect((await goalRows(G1))[0]?.status).toBe('completed');

    await toasts(page).getByRole('button', { name: 'Urungkan' }).click();
    await expect.poll(async () => (await goalRows(G1))[0]?.status).toBe('active');
    await page.goto(tujuanUrl('pribadi'));
    await expect(card(page, G1)).toBeVisible();

    // Selesaikan lagi (tanpa urungkan) untuk langkah berikutnya.
    await card(page, G1)
      .getByRole('button', { name: `Selesaikan tujuan ${G1}` })
      .click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Selesaikan', exact: true })
      .click();
    await expect(toasts(page).getByText(`Tujuan ${G1} selesai`).last()).toBeVisible();
    await expect.poll(async () => (await goalRows(G1))[0]?.status).toBe('completed');
    expect(await incomeExpense()).toEqual(base);
  },
);

test('tujuan baru di dompet yang sama; Pulihkan yang lama terhalang; Ubah; Arsipkan + Urungkan', async ({
  page,
}) => {
  await page.goto(tujuanUrl('pribadi'));
  const closed = main(page).getByText(/Selesai dan diarsipkan \(1\)/);
  await expect(closed).toBeVisible();
  const sheet = await openAdd(page);
  await expect(sheet.getByText(`Sudah ada Rp ${digits(10_500_000)} di ${TAB}`)).toBeVisible();
  await fillGoal(sheet, G2, 50_000_000);
  await sheet.getByRole('button', { name: 'Simpan tujuan' }).click();
  await expect(toasts(page).getByText(`Tujuan ${G2} dibuat di Pribadi`)).toBeVisible();
  await expect(card(page, G2)).toContainText('21%');
  // Tanpa tanggal target: tanpa Perlu.
  await expect(card(page, G2)).not.toContainText('Perlu');

  // Pulihkan tujuan lama terhalang: kalimat, bukan tombol.
  await closed.click();
  await expect(main(page).getByRole('button', { name: `Pulihkan tujuan ${G1}` })).toHaveCount(0);
  await expect(
    main(page).getByText(
      `${TAB} sudah punya tujuan aktif. Selesaikan atau arsipkan tujuan itu dulu.`,
    ),
  ).toBeVisible();

  // Ubah: nama, target; dompet tidak bisa diganti.
  const ubah = main(page).getByRole('button', { name: `Ubah tujuan ${G2}` });
  const editSheet = page.getByRole('dialog', { name: /^Ubah tujuan/ });
  await expect(async () => {
    if ((await editSheet.count()) === 0) await ubah.click();
    await expect(editSheet.getByRole('textbox', { name: /Nama tujuan/ })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  await expect(editSheet.getByText(`Dompet: ${TAB}`)).toBeVisible();
  await expect(editSheet.getByRole('combobox')).toHaveCount(0);
  await editSheet.getByRole('textbox', { name: /Target/ }).fill('20000000');
  await editSheet.getByLabel(/Tanggal target/).fill(TARGET_ON);
  await editSheet.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(toasts(page).getByText(`Tujuan ${G2} diperbarui di Pribadi`)).toBeVisible();
  await expect(card(page, G2)).toContainText('52%');
  await expect(card(page, G2)).toContainText(/Perlu Rp\s[\d.]+\/bulan/);

  // Arsipkan lalu Urungkan.
  await main(page)
    .getByRole('button', { name: `Arsipkan tujuan ${G2}` })
    .click();
  const dialog = page.getByRole('alertdialog', { name: `Arsipkan ${G2}?` });
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText('juga hilang');
  await dialog.getByRole('button', { name: 'Arsipkan', exact: true }).click();
  await expect(toasts(page).getByText(`Tujuan ${G2} diarsipkan`)).toBeVisible();
  await expect.poll(async () => (await goalRows(G2))[0]?.status).toBe('archived');
  await toasts(page).getByRole('button', { name: 'Urungkan' }).click();
  await expect.poll(async () => (await goalRows(G2))[0]?.status).toBe('active');
  expect(await incomeExpense()).toEqual(base);
});

test(
  'Bersama: tujuan dibuat, solo tanpa "Dibuat", tanpa jejak tujuan Pribadi (HTML + RSC)',
  { tag: ['@B22'] },
  async ({ page }) => {
    await page.goto(tujuanUrl('bersama'));
    await expect(
      main(page).getByRole('heading', { name: 'Belum ada dompet tabungan.' }),
    ).toBeVisible();
    await addSavings(page, 'bersama', TAB_B);
    await page.goto(tujuanUrl('bersama'));
    const sheet = await openAdd(page);
    await expect(sheet).toContainText('Bersama');
    await fillGoal(sheet, NAME60, 12_345_678_900);
    await sheet.getByRole('button', { name: 'Simpan tujuan' }).click();
    await expect(toasts(page).getByText(`Tujuan ${NAME60} dibuat di Bersama`)).toBeVisible();
    const c = card(page, NAME60);
    await expect(c).toBeVisible();
    await expect(c).not.toContainText('Dibuat ');
    const nav = page.getByRole('navigation', { name: 'Bagian Rencana' });
    await expect(nav.getByRole('link')).toHaveText(['Anggaran', 'Tagihan', 'Tujuan']);

    const { bodies, unread } = await bersamaResponses(page, () => page.goto(tujuanUrl('bersama')));
    expect(unread).toEqual([]);
    for (const body of bodies) {
      expect(body).not.toContain(G1);
      expect(body).not.toContain(G2);
      expect(body).not.toContain(TAB);
    }
  },
);

test('segmen empat item di 320 px terbaca utuh; tanpa gulir samping; axe di dua tema dan tiga lebar', async ({
  page,
}) => {
  for (const [w, h] of [
    [320, 640],
    [390, 844],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const theme of ['dark', 'light']) {
      await page.goto(`${tujuanUrl('pribadi')}&theme=${theme}`);
      await expect(card(page, G2)).toBeVisible();
      await expectNoSeriousViolations(page);
      await noHorizontalScroll(page);
      const items = await page
        .getByRole('navigation', { name: 'Bagian Rencana' })
        .getByRole('link')
        .evaluateAll((els) =>
          els.map((e) => ({
            text: e.textContent,
            clipped: e.scrollWidth > e.clientWidth,
            w: Math.round(e.getBoundingClientRect().width),
            h: Math.round(e.getBoundingClientRect().height),
          })),
        );
      test.info().annotations.push({
        type: `segmen-${String(w)}-${theme}`,
        description: items.map((i) => `${i.text}:${String(i.w)}x${String(i.h)}`).join(' '),
      });
      for (const i of items) {
        expect(i.clipped, `${i.text} terpotong di ${String(w)}`).toBe(false);
        expect(i.h).toBeGreaterThanOrEqual(44);
      }
    }
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`${tujuanUrl('bersama')}&theme=dark`);
  await expect(card(page, NAME60)).toBeVisible();
  await expectNoSeriousViolations(page);
  await noHorizontalScroll(page);
  await expect(card(page, NAME60)).toContainText(/Rp\s12\.345\.678\.900/);
  await expect(card(page, NAME60).getByRole('heading')).toHaveAttribute('title', NAME60);
});

test('budget JS: Rencana (Anggaran) dan Rencana > Tujuan ≤ 162 kB', async ({
  browser,
  ownerState,
}) => {
  for (const url of [
    '/pribadi/rencana',
    '/pribadi/rencana?bagian=tujuan',
    '/bersama/rencana?bagian=tujuan',
  ]) {
    await expectRouteBudget(browser, ownerState, url);
  }
});

// Bahan design reviewer (bukan regresi): hanya bila SHOTS_DIR diisi.
test('screenshot Tujuan 320/390/1280 gelap dan terang', async ({ page }) => {
  const dir = process.env.SHOTS_DIR;
  test.skip(dir === undefined, 'screenshot hanya dengan SHOTS_DIR');
  for (const [w, h] of [
    [320, 700],
    [390, 900],
    [1280, 900],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const theme of ['dark', 'light']) {
      for (const ruang of ['pribadi', 'bersama'] as const) {
        await page.goto(`${tujuanUrl(ruang)}&theme=${theme}`);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: `${dir ?? ''}/tujuan-${ruang}-${String(w)}-${theme}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
  }
});
