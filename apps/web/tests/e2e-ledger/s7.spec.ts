import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations, WCAG_TAGS } from '../e2e/axe';
import { noHorizontalScroll } from '../e2e-auth/helpers';
import { adminQuery, expect, test } from './fixtures';
import {
  addWallet,
  bersamaResponses,
  BUDGET_KB,
  chipsOf,
  digits,
  expectRouteBudget,
  openCatat,
  toasts,
  walletBalance,
} from './helpers';

/**
 * Kriteria keluar S7 ujung ke ujung di mode nyata (Task 17): setor Pribadi → Bersama lewat Catat
 * dengan kanari (rute Bersama, navigasi klien dan muat ulang, HTML + payload RSC), Batalkan satu
 * kaki = keduanya; talangan → reimburse sebagian → sisa di Dompet dan Detail; Pindahkan Pribadi →
 * Bersama (R24, fokus, Sampah, banner URL lama); Cocokkan saldo + Urungkan; arsip dompet saldo 0;
 * Beranda Bersama solo (B1); keyboard saja; axe; budget JS rute S7. Satu urutan serial; data sendiri
 * (nama dompet/keterangan khas S7), jadi bisa jalan sendiri atau sesudah `ledger.spec.ts`.
 */

test.describe.configure({ mode: 'serial' });

/** Kanari Pribadi (Review Focus #1): nama dompet dan keterangan yang tidak boleh sampai Bersama. */
const PRIBADI_WALLET = 'BCA Pribadi';
const PRIBADI_DESC = 'bayar kos adik';
const BERSAMA_WALLET = 'Kas Rumah S7';
const TALANGAN_DESC = 'TALANGAN-S7-E2E';
const MOVE_DESC = 'PINDAH-S7-E2E';
const AXE_DESC = 'AXE-S7-E2E';
const ARCHIVE_WALLET = 'Dompet Lama S7';

/** Halaman yang dipakai tes berikutnya (diisi berurutan). */
const paths = {
  /** Detail kaki Pribadi / Bersama transfer antar ruang yang tetap hidup. */
  pribadiLeg: '',
  bersamaLeg: '',
  talangan: '',
  moved: '',
  axeEntry: '',
  pribadiWallet: '',
  bersamaWallet: '',
};

const main = (page: Page) => page.getByRole('main');

async function accountId(name: string): Promise<string> {
  const [row] = await adminQuery<{ id: string }>(
    'select id::text from app.accounts where name = $1',
    [name],
  );
  if (!row) throw new Error(`dompet ${name} tidak ada`);
  return row.id;
}

/** Kedua kaki transfer antar ruang terbaru (hidup atau batal) dari dompet Pribadi `PRIBADI_WALLET`. */
async function legsOfLatestTransfer(): Promise<{
  pribadi: { id: string; voided: boolean };
  bersama: { id: string; voided: boolean; description: string | null; note: string | null };
}> {
  const rows = await adminQuery<{
    id: string;
    space_kind: string;
    voided: boolean;
    description: string | null;
    shared_note: string | null;
  }>(
    `select e.id::text, e.space_kind::text, e.voided_at is not null as voided, e.description,
            e.shared_note
       from app.entries e
      where e.link_id = (select link_id from app.entries
                          where kind = 'space_transfer' and space_kind = 'personal'
                          order by created_at desc limit 1)`,
  );
  const p = rows.find((r) => r.space_kind === 'personal');
  const b = rows.find((r) => r.space_kind === 'shared');
  if (!p || !b) throw new Error('kaki transfer tidak lengkap');
  return {
    pribadi: { id: p.id, voided: p.voided },
    bersama: { id: b.id, voided: b.voided, description: b.description, note: b.shared_note },
  };
}

/**
 * Catat transfer antar ruang Pribadi → Bersama: Catat → jenis Transfer → dompet Pribadi →
 * `Ruang lain…` → dompet Bersama → keterangan (hanya di Pribadi) → Simpan. Toast tanpa nama dompet.
 */
async function setorKeBersama(page: Page, amount: number, description: string): Promise<void> {
  await page.goto('/pribadi/beranda');
  await openCatat(page);
  const expense = page.getByRole('dialog', { name: 'Pengeluaran · Pribadi' });
  await expense.getByRole('button', { name: 'Pengeluaran · Pribadi' }).click();
  await page.getByRole('menuitemradio', { name: 'Transfer' }).click();
  let sheet = page.getByRole('dialog', { name: 'Transfer · Pribadi' });
  await sheet.getByLabel('Dari dompet').selectOption({ label: PRIBADI_WALLET });
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill(String(amount));
  await sheet.getByRole('button', { name: /pilih dompet di ruang lain/ }).click();
  await page
    .getByRole('radiogroup', { name: 'Dompet di Bersama' })
    .getByRole('radio', { name: new RegExp(BERSAMA_WALLET) })
    .click();
  sheet = page.getByRole('dialog', { name: 'Transfer · Pribadi → Bersama' });
  await expect(sheet.getByRole('radio', { name: `${BERSAMA_WALLET} · Bersama` })).toBeVisible();
  await sheet.getByLabel(/Keterangan \(hanya di Pribadi\)/).fill(description);
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  const toast = toasts(page).getByText(`Tersimpan di Pribadi · Rp ${digits(amount)} ke Bersama`);
  await expect(toast).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await expect(
    toasts(page).getByText(new RegExp(`${PRIBADI_WALLET}|${BERSAMA_WALLET}`)),
  ).toHaveCount(0);
}

/** Catat pengeluaran Pribadi dari `PRIBADI_WALLET` (opsional talangan); belum ke Detail. */
async function catatPribadi(
  page: Page,
  {
    amount,
    description,
    talangan = false,
  }: { amount: number; description: string; talangan?: boolean },
): Promise<void> {
  await page.goto('/pribadi/beranda');
  const sheet = await openCatat(page);
  await sheet.getByRole('textbox', { name: 'Nominal' }).fill(String(amount));
  await sheet.getByLabel(/Keterangan/).fill(description);
  await sheet.getByLabel('Dari dompet').selectOption({ label: PRIBADI_WALLET });
  await chipsOf(sheet).first().click();
  if (talangan) {
    const toggle = sheet.getByRole('switch', { name: 'Talangan kantor' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  }
  await sheet.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(
    toasts(page).getByText(
      talangan
        ? new RegExp(`Rp\\s${digits(amount)} dari ${PRIBADI_WALLET} · Talangan kantor$`)
        : `Tersimpan di Pribadi · Rp ${digits(amount)} dari ${PRIBADI_WALLET}`,
    ),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);
}

/** Buka Detail entri berketerangan `description` dari Transaksi ruang itu; mengembalikan path. */
async function openDetail(page: Page, ruang: 'pribadi' | 'bersama', description: string) {
  await page.goto(`/${ruang}/transaksi`);
  await main(page)
    .getByRole('link', { name: new RegExp(description) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/${ruang}/transaksi/[0-9a-f-]{36}$`));
  return new URL(page.url()).pathname;
}

/** Fokus keyboard sampai `target` (Tab maju, maks `max` kali). */
async function tabTo(page: Page, target: Locator, max = 40): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

test('dompet S7 dan Beranda Bersama solo (B1)', async ({ page }) => {
  await addWallet(page, 'pribadi', PRIBADI_WALLET, 3_000_000);
  await addWallet(page, 'bersama', BERSAMA_WALLET, 1_000_000);
  paths.pribadiWallet = `/pribadi/dompet/${await accountId(PRIBADI_WALLET)}`;
  paths.bersamaWallet = `/bersama/dompet/${await accountId(BERSAMA_WALLET)}`;

  // Persona N tanpa F: Bersama berisi satu anggota. Kartu ajakan + Aktivitas kosong (pengantar
  // checklist B1 diperiksa di ledger.spec.ts selagi checklist masih tampil).
  const members = await adminQuery<{ n: string }>(
    `select count(*)::text as n from app.space_members m join app.spaces s on s.id = m.space_id
      where s.kind = 'shared'`,
  );
  expect(members[0]?.n).toBe('1');
  await page.goto('/bersama/beranda');
  await expect(main(page).getByText('Farida belum bergabung di Bersama.')).toBeVisible();
  await expect(main(page).getByRole('link', { name: 'Undang Farida ke Bersama' })).toBeVisible();
  await expect(main(page).getByText(/^Belum ada aktivitas\./)).toBeVisible();
  // Bersama punya dompet: bukan keadaan kosong (B2).
  await expect(main(page).getByText('Bersama belum punya dompet.')).toHaveCount(0);
});

test('setor Pribadi → Bersama: rute Bersama tanpa dompet, keterangan, dan id kaki Pribadi', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const pribadi0 = await walletBalance(page, 'pribadi', PRIBADI_WALLET);
  const bersama0 = await walletBalance(page, 'bersama', BERSAMA_WALLET);
  await setorKeBersama(page, 250_000, PRIBADI_DESC);
  const legs = await legsOfLatestTransfer();
  // Keterangan hanya di kaki Pribadi; catatan Bersama kosong karena tidak diisi.
  expect(legs.bersama.description).toBeNull();
  expect(legs.bersama.note).toBeNull();
  expect(await walletBalance(page, 'pribadi', PRIBADI_WALLET)).toBe(pribadi0 - 250_000);
  expect(await walletBalance(page, 'bersama', BERSAMA_WALLET)).toBe(bersama0 + 250_000);

  // Kanari benar-benar ada di Pribadi (tes tidak lulus karena data kosong).
  const pribadiDetail = await (
    await page.request.get(`/pribadi/transaksi/${legs.pribadi.id}`)
  ).text();
  expect(pribadiDetail).toContain(PRIBADI_DESC);
  expect(pribadiDetail).toContain(PRIBADI_WALLET);

  const kanari = [PRIBADI_WALLET, PRIBADI_DESC, legs.pribadi.id];
  const bersamaPaths = [
    '/bersama/beranda',
    '/bersama/transaksi',
    `/bersama/transaksi/${legs.bersama.id}`,
    '/bersama/sampah',
    '/bersama/dompet',
    paths.bersamaWallet,
    '/bersama/kategori',
  ];
  const expectClean = async (label: string) => {
    for (const path of bersamaPaths) {
      const html = await (await page.request.get(path)).text();
      const rsc = await (await page.request.get(path, { headers: { RSC: '1' } })).text();
      expect(html, path).toContain('Bersama');
      for (const body of [html, rsc])
        for (const k of kanari) expect(body.includes(k), `${label} ${path}: ${k}`).toBe(false);
    }
  };
  const expectNoKanari = ({ bodies, unread }: { bodies: string[]; unread: string[] }) => {
    expect(unread).toEqual([]);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) for (const k of kanari) expect(body.includes(k), k).toBe(false);
  };
  await expectClean('hidup');

  // Browser: muat dokumen tiap rute, muat ulang, lalu navigasi klien ke Transaksi dan Detail kaki
  // masuk (payload RSC navigasi klien ikut diperiksa).
  for (const path of bersamaPaths) {
    expectNoKanari(await bersamaResponses(page, () => page.goto(path)));
  }
  expectNoKanari(await bersamaResponses(page, () => page.reload()));
  await page.goto('/bersama/beranda');
  const nav = await bersamaResponses(page, async () => {
    await page
      .getByRole('navigation', { name: 'Navigasi utama' })
      .getByRole('link', { name: 'Transaksi' })
      .click();
    await expect(page).toHaveURL(/\/bersama\/transaksi$/);
    await main(page)
      .getByRole('link', { name: /Setoran dari Novanda/ })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/bersama/transaksi/${legs.bersama.id}$`));
  });
  expectNoKanari(nav);
  // Muat ulang Detail kaki masuk (dokumen + RSC dari server, bukan cache klien).
  expectNoKanari(await bersamaResponses(page, () => page.reload()));
  // Detail kaki masuk: dompet Bersama sendiri (R9), bukan dompet Pribadi.
  await expect(main(page).getByText(BERSAMA_WALLET).first()).toBeVisible();
  await expect(
    main(page)
      .getByText(/250\.000/)
      .first(),
  ).toBeVisible();

  // Batalkan satu kaki (dari Bersama, oleh pencatat): kedua kaki batal, kedua saldo kembali.
  await main(page).getByRole('button', { name: 'Batalkan transaksi' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Batalkan transfer antar ruang?' });
  await dialog.getByRole('button', { name: 'Batalkan transfer' }).click();
  await expect(page).toHaveURL(/\/bersama\/transaksi$/);
  const after = await legsOfLatestTransfer();
  expect(after.pribadi).toEqual({ id: legs.pribadi.id, voided: true });
  expect(after.bersama.voided).toBe(true);
  expect(await walletBalance(page, 'pribadi', PRIBADI_WALLET)).toBe(pribadi0);
  expect(await walletBalance(page, 'bersama', BERSAMA_WALLET)).toBe(bersama0);
  await page.goto(`/pribadi/transaksi/${legs.pribadi.id}`);
  await expect(main(page).getByText('Transaksi ini sudah dibatalkan.')).toBeVisible();

  // Sampah Bersama memuat kaki batal: tetap tanpa kanari.
  await page.goto('/bersama/sampah');
  await expect(
    main(page)
      .getByText(/Setoran dari Novanda/)
      .first(),
  ).toBeVisible();
  await expectClean('batal');
  expectNoKanari(await bersamaResponses(page, () => page.reload()));

  // Transfer kedua tetap hidup untuk axe dan budget.
  await setorKeBersama(page, 120_000, PRIBADI_DESC);
  const live = await legsOfLatestTransfer();
  expect(live.pribadi.voided).toBe(false);
  paths.pribadiLeg = `/pribadi/transaksi/${live.pribadi.id}`;
  paths.bersamaLeg = `/bersama/transaksi/${live.bersama.id}`;
  kanari.push(live.pribadi.id);
  await expectClean('hidup kedua');
});

test('talangan → reimburse sebagian → sisa di Dompet dan Detail', async ({ page }) => {
  await catatPribadi(page, { amount: 500_000, description: TALANGAN_DESC, talangan: true });
  const rows = await adminQuery<{ reimbursable: boolean }>(
    'select reimbursable from app.entries where description = $1',
    [TALANGAN_DESC],
  );
  expect(rows).toEqual([{ reimbursable: true }]);

  await page.goto('/pribadi/dompet');
  const waiting = main(page).getByRole('list', { name: 'Talangan menunggu reimburse' });
  await expect(waiting.getByRole('link', { name: new RegExp(TALANGAN_DESC) })).toContainText(
    '500.000',
  );

  paths.talangan = await openDetail(page, 'pribadi', TALANGAN_DESC);
  await expect(main(page).getByText('Menunggu reimburse · sisa Rp 500.000')).toBeVisible();
  const saldo0 = await (async () => {
    const url = page.url();
    const n = await walletBalance(page, 'pribadi', PRIBADI_WALLET);
    await page.goto(url);
    return n;
  })();

  const open = main(page).getByRole('button', { name: 'Catat reimburse' });
  const sheet = page.getByRole('dialog').filter({
    has: page.getByRole('textbox', { name: 'Jumlah diganti' }),
  });
  await expect(async () => {
    if ((await sheet.count()) === 0) await open.click();
    await expect(sheet.getByRole('textbox', { name: 'Jumlah diganti' })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  const amount = sheet.getByRole('textbox', { name: 'Jumlah diganti' });
  // Nominal bawaan = sisa.
  await expect(amount).toHaveValue('500.000');
  await amount.fill('300000');
  await sheet.getByLabel('Ke dompet').selectOption({ label: PRIBADI_WALLET });
  await sheet.getByRole('button', { name: 'Simpan reimburse' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(
    main(page).getByText('Menunggu reimburse · sisa Rp 200.000 dari Rp 500.000'),
  ).toBeVisible();
  await expect(
    main(page).getByRole('list', { name: 'Reimburse untuk talangan ini' }).getByRole('link'),
  ).toContainText(['300.000']);
  // Talangan dengan reimburse hidup: tanpa Batalkan dan tanpa `Tidak diganti`.
  await expect(main(page).getByRole('button', { name: 'Batalkan transaksi' })).toHaveCount(0);
  await expect(main(page).getByRole('button', { name: 'Tidak diganti' })).toHaveCount(0);

  expect(await walletBalance(page, 'pribadi', PRIBADI_WALLET)).toBe(saldo0 + 300_000);
  await page.goto('/pribadi/dompet');
  const row = waiting.getByRole('link', { name: new RegExp(TALANGAN_DESC) });
  await expect(row).toContainText('sisa Rp 200.000 dari Rp 500.000');
});

test('keyboard saja: Pindahkan Pribadi → Bersama, ke Transaksi Bersama (R24) dengan fokus di judul', async ({
  page,
}) => {
  await catatPribadi(page, { amount: 45_000, description: MOVE_DESC });
  paths.moved = await openDetail(page, 'pribadi', MOVE_DESC);
  const movedId = paths.moved.split('/').at(-1) ?? '';

  const move = main(page).getByRole('button', { name: 'Pindahkan ke Bersama' });
  await tabTo(page, move);
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Pindahkan ke Bersama' });
  const select = sheet.getByLabel('Dompet di Bersama');
  // Fokus awal ke Select dompet sesudah data ruang tujuan termuat.
  await expect(select).toBeFocused();
  for (let i = 0; i < 10; i++) {
    if ((await select.locator('option:checked').innerText()) === BERSAMA_WALLET) break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(select.locator('option:checked')).toHaveText(BERSAMA_WALLET);
  const chip = chipsOf(sheet).first();
  if ((await chip.getAttribute('aria-checked')) !== 'true') {
    await tabTo(page, chip);
    await page.keyboard.press('Space');
  }
  await expect(chip).toHaveAttribute('aria-checked', 'true');
  // Keterangan tidak dibawa (bawaan mati, R11).
  await expect(sheet.getByRole('checkbox', { name: 'Bawa keterangan' })).not.toBeChecked();
  await tabTo(page, sheet.getByRole('button', { name: 'Lanjut' }));
  await page.keyboard.press('Enter');
  const confirm = page.getByRole('alertdialog', { name: 'Pindahkan ke Bersama?' });
  await expect(confirm.getByText('Keterangan tidak ikut dipindah.')).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Kembali' })).toBeFocused();
  await tabTo(page, confirm.getByRole('button', { name: 'Pindahkan' }), 5);
  await page.keyboard.press('Enter');

  // R24: id entri baru tidak dikembalikan; ke Transaksi Bersama, fokus ke judul halaman.
  await expect(page).toHaveURL(/\/bersama\/transaksi$/);
  await expect(main(page).getByRole('heading', { level: 1 })).toBeFocused();

  // Entri asal batal + ditandai dipindah; keterangan Pribadi tidak ikut ke Bersama (satu baris).
  const origin = await adminQuery<{ voided: boolean; moved: boolean }>(
    `select voided_at is not null as voided, moved_at is not null as moved
       from app.entries where id = $1`,
    [movedId],
  );
  expect(origin).toEqual([{ voided: true, moved: true }]);
  expect(
    (
      await adminQuery<{ n: string }>(
        'select count(*)::text as n from app.entries where description = $1',
        [MOVE_DESC],
      )
    )[0]?.n,
  ).toBe('1');
  const bersamaHtml = await (await page.request.get('/bersama/transaksi')).text();
  expect(bersamaHtml).not.toContain(MOVE_DESC);
  await expect(main(page).getByText('45.000').first()).toBeVisible();

  // Entri asal tidak di Sampah Pribadi; URL lama = banner pindah tanpa Pulihkan.
  await page.goto('/pribadi/sampah');
  await expect(main(page).getByRole('heading', { level: 1 })).toBeVisible();
  await expect(main(page).getByText(MOVE_DESC)).toHaveCount(0);
  await page.goto(paths.moved);
  await expect(main(page).getByText('Transaksi ini sudah dipindahkan ke Bersama.')).toBeVisible();
  await expect(main(page).getByRole('link', { name: 'Buka di Bersama' })).toHaveAttribute(
    'href',
    '/bersama/transaksi',
  );
  await expect(main(page).getByRole('button', { name: /Pulihkan/ })).toHaveCount(0);
});

test('keyboard saja: Cocokkan saldo lalu Urungkan', async ({ page }) => {
  const saldo0 = await walletBalance(page, 'pribadi', PRIBADI_WALLET);
  const target = saldo0 + 12_345;
  await page.goto(paths.pribadiWallet);
  const open = main(page).getByRole('button', { name: 'Cocokkan saldo' });
  await expect(open).toBeVisible();
  await tabTo(page, open);
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: `Cocokkan saldo · ${PRIBADI_WALLET}` });
  const input = sheet.getByRole('textbox', { name: 'Saldo sebenarnya' });
  await expect(input).toBeFocused();
  await page.keyboard.type(String(target));
  await expect(sheet.getByText(/Selisih\s\+Rp\s12\.345/)).toBeVisible();
  await tabTo(page, sheet.getByRole('button', { name: 'Cocokkan saldo' }), 10);
  await page.keyboard.press('Enter');
  const toast = toasts(page).getByText(
    `Saldo ${PRIBADI_WALLET} dicocokkan di Pribadi · selisih +Rp 12.345`,
  );
  await expect(toast).toBeVisible();
  await expect(sheet).toHaveCount(0);
  const adj = await adminQuery<{ voided: boolean }>(
    `select voided_at is not null as voided from app.entries
      where kind = 'adjustment' order by created_at desc limit 1`,
  );
  expect(adj).toEqual([{ voided: false }]);
  await expect(
    main(page)
      .getByText(`Rp ${digits(target)}`)
      .first(),
  ).toBeVisible();

  await toasts(page).getByRole('button', { name: 'Urungkan' }).click();
  await expect
    .poll(
      async () =>
        (
          await adminQuery<{ voided: boolean }>(
            `select voided_at is not null as voided from app.entries
              where kind = 'adjustment' order by created_at desc limit 1`,
          )
        )[0]?.voided,
    )
    .toBe(true);
  expect(await walletBalance(page, 'pribadi', PRIBADI_WALLET)).toBe(saldo0);
});

test('Cocokkan saldo ke 0 lalu arsipkan dompet', async ({ page }) => {
  await addWallet(page, 'pribadi', ARCHIVE_WALLET, 10_000);
  await page.goto('/pribadi/dompet');
  await main(page)
    .getByRole('link', { name: new RegExp(ARCHIVE_WALLET) })
    .click();
  await expect(page).toHaveURL(/\/pribadi\/dompet\/[0-9a-f-]{36}$/);
  // Saldo bukan 0: arsip belum ditawarkan.
  await expect(main(page).getByRole('button', { name: 'Arsipkan dompet' })).toHaveCount(0);

  const open = main(page).getByRole('button', { name: 'Cocokkan saldo' });
  const sheet = page.getByRole('dialog', { name: `Cocokkan saldo · ${ARCHIVE_WALLET}` });
  await expect(async () => {
    if ((await sheet.count()) === 0) await open.click();
    await expect(sheet.getByRole('textbox', { name: 'Saldo sebenarnya' })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  await sheet.getByRole('textbox', { name: 'Saldo sebenarnya' }).fill('0');
  await sheet.getByRole('button', { name: 'Cocokkan saldo' }).click();
  await expect(
    toasts(page).getByText(`Saldo ${ARCHIVE_WALLET} dicocokkan di Pribadi · selisih −Rp 10.000`),
  ).toBeVisible();

  const archive = main(page).getByRole('button', { name: 'Arsipkan dompet' });
  await archive.click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Arsipkan', exact: true })
    .click();
  await expect(toasts(page).getByText(`${ARCHIVE_WALLET} diarsipkan di Pribadi`)).toBeVisible();
  await expect(page).toHaveURL(/\/pribadi\/dompet$/);
  const rows = await adminQuery<{ archived: boolean }>(
    'select archived_at is not null as archived from app.accounts where name = $1',
    [ARCHIVE_WALLET],
  );
  expect(rows).toEqual([{ archived: true }]);
});

test('axe 0 serious/critical terang + gelap di 320/390/1280 untuk layar S7; tanpa gulir horizontal di 320', async ({
  page,
}) => {
  test.setTimeout(480_000);
  // Entri hidup biasa untuk sheet Pindahkan (tidak disimpan).
  await catatPribadi(page, { amount: 21_000, description: AXE_DESC });
  paths.axeEntry = await openDetail(page, 'pribadi', AXE_DESC);
  for (const p of Object.values(paths)) expect(p).not.toBe('');
  const entries0 = (
    await adminQuery<{ n: string }>('select count(*)::text as n from app.entries')
  )[0]?.n;

  const screens: { path: string; ready: (p: Page) => Locator }[] = [
    { path: paths.pribadiLeg, ready: (p) => main(p).getByText(PRIBADI_DESC).first() },
    {
      path: paths.bersamaLeg,
      ready: (p) =>
        main(p)
          .getByText(/Setoran dari Novanda/)
          .first(),
    },
    { path: paths.talangan, ready: (p) => main(p).getByText(/Menunggu reimburse · sisa/) },
    {
      path: paths.moved,
      ready: (p) => main(p).getByText('Transaksi ini sudah dipindahkan ke Bersama.'),
    },
    {
      path: '/pribadi/dompet',
      ready: (p) => main(p).getByRole('list', { name: 'Talangan menunggu reimburse' }),
    },
    {
      path: paths.pribadiWallet,
      ready: (p) => main(p).getByRole('button', { name: 'Cocokkan saldo' }),
    },
    {
      path: paths.bersamaWallet,
      ready: (p) => main(p).getByRole('button', { name: 'Cocokkan saldo' }),
    },
    {
      path: '/bersama/beranda',
      ready: (p) => main(p).getByText('Farida belum bergabung di Bersama.'),
    },
  ];
  const check = async (width: number) => {
    await expectNoSeriousViolations(page, { tags: WCAG_TAGS });
    if (width === 320) await noHorizontalScroll(page);
  };
  for (const theme of ['dark', 'light']) {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const s of screens) {
        await page.goto(`${s.path}?theme=${theme}`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(s.ready(page)).toBeVisible();
        await check(width);
      }

      // Sheet Pindahkan + dialog konfirmasinya (Kembali = tidak ada yang dipindah).
      await page.goto(`${paths.axeEntry}?theme=${theme}`);
      const move = main(page).getByRole('button', { name: 'Pindahkan ke Bersama' });
      const moveSheet = page.getByRole('dialog', { name: 'Pindahkan ke Bersama' });
      await expect(async () => {
        if ((await moveSheet.count()) === 0) await move.click();
        await expect(moveSheet.getByLabel('Dompet di Bersama')).toBeVisible({ timeout: 2_000 });
      }).toPass();
      await check(width);
      await moveSheet.getByLabel('Dompet di Bersama').selectOption({ label: BERSAMA_WALLET });
      await chipsOf(moveSheet).first().click();
      await moveSheet.getByRole('button', { name: 'Lanjut' }).click();
      const confirm = page.getByRole('alertdialog', { name: 'Pindahkan ke Bersama?' });
      await expect(confirm.getByRole('button', { name: 'Kembali' })).toBeFocused();
      await check(width);
      await confirm.getByRole('button', { name: 'Kembali' }).click();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      // Sheet Cocokkan saldo dengan pratinjau selisih (tidak disimpan).
      await page.goto(`${paths.pribadiWallet}?theme=${theme}`);
      const open = main(page).getByRole('button', { name: 'Cocokkan saldo' });
      const sheet = page.getByRole('dialog', { name: `Cocokkan saldo · ${PRIBADI_WALLET}` });
      await expect(async () => {
        if ((await sheet.count()) === 0) await open.click();
        await expect(sheet.getByRole('textbox', { name: 'Saldo sebenarnya' })).toBeVisible({
          timeout: 2_000,
        });
      }).toPass();
      await sheet.getByRole('textbox', { name: 'Saldo sebenarnya' }).fill('1');
      await expect(sheet.getByText(/Selisih/)).toBeVisible();
      await check(width);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  }
  // Tidak ada yang tersimpan selama pemeriksaan.
  expect(
    (await adminQuery<{ n: string }>('select count(*)::text as n from app.entries'))[0]?.n,
  ).toBe(entries0);
});

const BUDGET_ROUTES: [string, () => string][] = [
  ['/pribadi/kategori', () => '/pribadi/kategori'],
  ['/pribadi/dompet/[id]', () => paths.pribadiWallet],
  ['/pribadi/transaksi/[id] talangan', () => paths.talangan],
  ['/pribadi/transaksi/[id] antar ruang', () => paths.pribadiLeg],
  ['/bersama/beranda', () => '/bersama/beranda'],
  ['/bersama/transaksi', () => '/bersama/transaksi'],
  ['/bersama/transaksi/[id] antar ruang', () => paths.bersamaLeg],
  ['/bersama/sampah', () => '/bersama/sampah'],
  ['/bersama/dompet', () => '/bersama/dompet'],
  ['/bersama/dompet/[id]', () => paths.bersamaWallet],
  ['/bersama/kategori', () => '/bersama/kategori'],
];

for (const [name, url] of BUDGET_ROUTES) {
  test(`JS muat dingin ${name} mode nyata ≤ ${String(BUDGET_KB)} kB`, async ({
    browser,
    ownerState,
  }) => {
    expect(url()).not.toBe('');
    await expectRouteBudget(browser, ownerState, url());
  });
}
