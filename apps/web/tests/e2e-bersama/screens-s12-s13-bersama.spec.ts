import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import type { Browser, Locator, Page } from '@playwright/test';
import { asUser, spaceOf } from '../e2e-auth/helpers';
import { adminQuery } from '../e2e-ledger/fixtures';
import { openAndFill } from '../e2e-ledger/helpers';
import { expect, test } from './fixtures';
import { OWNER, PARTNER } from './global-setup';

/**
 * Screenshot S12 (patungan) dan S13 (Tujuan Bersama) dengan dua anggota untuk design critique
 * (`docs/design/s12-s13-critique.md`). Bukan tes regresi: dilewati kecuali `SHOTS_DIR` diisi; config
 * memilih tes bertanda `@screens` dengan `SCREENS=1`:
 * `SCREENS=1 SHOTS_DIR=... playwright test -c playwright.bersama.config.ts screens-s12-s13-bersama`.
 * Data lewat `api.*` sebagai N atau F; audit teks/warna ke `_audit.jsonl` (sama dengan spec ledger).
 */
const DIR = process.env.SHOTS_DIR;
test.skip(DIR === undefined, 'screenshot hanya dengan SHOTS_DIR');
test.describe.configure({ mode: 'serial' });
test.setTimeout(900_000);

const OUT = DIR ?? '';
const BASE = 'http://localhost:3302';
const main = (page: Page) => page.getByRole('main');
const WIDTHS = [320, 390, 1280] as const;
const THEMES = ['dark', 'light'] as const;
const BIG = 12_345_678_900;
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

interface Who {
  uid: string;
  sid: string;
  psid: string;
}
let n: Who;
let f: Who;
const ids: Record<string, string> = {};
let splitIds: Record<string, string> = {};

async function who(email: string): Promise<Who> {
  const p = await spaceOf(email, 'personal');
  const s = await spaceOf(email, 'shared');
  return { uid: p.uid, psid: p.sid, sid: s.sid };
}

async function wallet(w: Who, space: string, name: string, pocket: string, opening: number) {
  await asUser(
    w.uid,
    `select api.create_account(p_client_id => $1, p_space_id => $2, p_name => $3,
       p_pocket => $4::app.pocket, p_wallet_type => 'bank', p_opening_balance => $5::bigint)`,
    [randomUUID(), space, name, pocket, opening],
  );
  const [a] = await adminQuery<{ id: string }>(
    'select id::text from app.accounts where space_id = $1 and name = $2',
    [space, name],
  );
  if (!a) throw new Error(name);
  ids[`${space}:${name}`] = a.id;
  return a.id;
}

async function split(
  w: Who,
  accountName: string,
  amount: number,
  description: string,
  shares?: { user: string; amount: number }[],
) {
  const [cat] = await adminQuery<{ id: string }>(
    `select id::text from app.categories where space_id = $1 and type = 'expense'
      and parent_id is null order by sort_order offset 1 limit 1`,
    [n.sid],
  );
  await asUser(
    w.uid,
    `select api.create_split(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_amount => $4::bigint, p_category_id => $5, p_description => $6, p_shares => $7::jsonb)`,
    [
      randomUUID(),
      n.sid,
      ids[`${w.psid}:${accountName}`],
      amount,
      cat?.id,
      description,
      shares ? JSON.stringify(shares.map((s) => ({ user_id: s.user, amount: s.amount }))) : null,
    ],
  );
  const [r] = await adminQuery<{ id: string }>(
    `select s.id::text from app.splits s join app.entries e on e.id = s.expense_entry_id
      where e.description = $1 order by s.created_at desc limit 1`,
    [description],
  );
  if (!r) throw new Error(`split ${description}`);
  splitIds[description] = r.id;
}

async function owedByF(): Promise<number> {
  const [r] = await adminQuery<{ owed: string }>(
    `select (coalesce((select sum(sh.amount) from app.split_shares sh
                         join app.splits s on s.id = sh.split_id and s.space_id = sh.space_id
                        where sh.space_id = $1 and sh.user_id = $2 and s.voided_at is null
                          and s.payer_id <> $2), 0)
           - coalesce((select sum(t.amount) from app.settlements t
                        where t.space_id = $1 and t.from_user = $2 and t.voided_at is null), 0))::text
            as owed`,
    [n.sid, f.uid],
  );
  return Number(r?.owed);
}

interface Audit {
  name: string;
  who: string;
  w: number;
  theme: string;
  overflow: number;
  banned: string[];
  rpZero: string[];
  coloredNumbers: string[];
}

async function auditPage(page: Page, name: string, w: number, theme: string, user: string) {
  const r = await page.evaluate(() => {
    const probe = (v: string) => {
      const el = document.createElement('span');
      el.style.color = `var(${v})`;
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    };
    const flagged: Record<string, string> = {
      [probe('--danger')]: 'danger',
      [probe('--warning')]: 'warning',
      [probe('--income')]: 'income',
    };
    const root = document.querySelector('main') ?? document.body;
    const text = root.innerText;
    const banned = [
      ...text.matchAll(/Hutang|hutang|rumah tangga|Goal|goal|!|\p{Extended_Pictographic}/gu),
    ].map((m) => m[0]);
    const rpZero = [...text.matchAll(/.{0,30}Rp\s?0(?![\d.])(?!\s?\/).{0,20}/g)].map((m) => m[0]);
    const colored: string[] = [];
    root.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const own = [...el.childNodes]
        .filter((x) => x.nodeType === 3)
        .map((x) => x.textContent ?? '')
        .join('')
        .trim();
      if (!own || !/(Rp\s?\d|\d+\s?%|Kurang|berutang|Piutang)/.test(own)) return;
      const tag = flagged[getComputedStyle(el).color];
      if (tag) colored.push(`${tag}: ${own.slice(0, 60)}`);
    });
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      banned,
      rpZero,
      colored,
    };
  });
  const a: Audit = {
    name,
    who: user,
    w,
    theme,
    overflow: r.overflow,
    banned: r.banned,
    rpZero: r.rpZero,
    coloredNumbers: r.colored,
  };
  return a;
}

async function fail(name: string, e: unknown) {
  await appendFile(`${OUT}/_failures.txt`, `${name}: ${String(e).split('\n')[0] ?? ''}\n`);
}

type Act = (p: Page) => Promise<void>;
interface Opts {
  viewport?: boolean;
  widths?: readonly number[];
  themes?: readonly ('dark' | 'light')[];
}

async function shoot(
  browser: Browser,
  state: string,
  user: 'N' | 'F',
  name: string,
  path: string,
  act?: Act,
  opts: Opts = {},
) {
  for (const theme of opts.themes ?? THEMES) {
    for (const w of opts.widths ?? WIDTHS) {
      const h = w === 1280 ? 800 : w === 320 ? 640 : 844;
      const context = await browser.newContext({
        storageState: state,
        viewport: { width: w, height: h },
        reducedMotion: 'reduce',
        baseURL: BASE,
      });
      const page = await context.newPage();
      try {
        await page.goto(`${path}${path.includes('?') ? '&' : '?'}theme=${theme}`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        if (act) await act(page);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(350);
        await appendFile(
          `${OUT}/_audit.jsonl`,
          `${JSON.stringify(await auditPage(page, name, w, theme, user))}\n`,
        );
        if (opts.viewport !== true) {
          await page.evaluate(() => {
            document.querySelectorAll<HTMLElement>('nav[aria-label="Tab utama"]').forEach((el) => {
              el.style.display = 'none';
            });
          });
          if (w === 1280) {
            const dh = await page.evaluate(() => document.documentElement.scrollHeight);
            await page.setViewportSize({ width: w, height: Math.min(Math.max(h, dh), 3000) });
            await page.waitForTimeout(250);
          }
        }
        await page.screenshot({
          path: `${OUT}/${name}-${user}-${String(w)}-${theme}.png`,
          fullPage: opts.viewport !== true,
          animations: 'disabled',
        });
      } catch (e) {
        await fail(`${name}-${user}-${String(w)}-${theme}`, e);
      } finally {
        await context.close();
      }
    }
  }
}

async function openUntil(open: () => Locator, dialog: Locator, field?: Locator) {
  await expect(async () => {
    if ((await dialog.count()) === 0) await open().click();
    await expect(field ?? dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

const patungan = '/bersama/patungan';
const beranda = '/bersama/beranda';

test('sebelum patungan: kosong, Catat toggle (F tanpa dompet Pribadi), Pembagian', { tag: '@screens' }, async ({
  browser,
  ownerState,
  partnerState,
}) => {
  await mkdir(OUT, { recursive: true });
  n = await who(OWNER);
  f = await who(PARTNER);
  await wallet(n, n.psid, 'BCA Novanda', 'operasional', 15_000_000);
  await shoot(browser, ownerState, 'N', 'pt-beranda-belum-ada', beranda);
  await shoot(browser, ownerState, 'N', 'pt-halaman-kosong', patungan);
  await shoot(browser, ownerState, 'N', 'tj-bersama-tanpa-dompet', '/bersama/rencana?bagian=tujuan');

  const catat = async (p: Page, extra?: (s: Locator) => Promise<void>) => {
    const sheet = await openAndFill(p, { amount: 400_000, description: 'Listrik Desember' });
    const toggle = sheet.getByRole('switch', { name: 'Dibayar dari dompet pribadi' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    if (extra) await extra(sheet);
  };
  await shoot(
    browser,
    ownerState,
    'N',
    'ct-toggle-mati',
    beranda,
    async (p) => {
      await openAndFill(p, { amount: 400_000, description: 'Listrik Desember' });
    },
    { viewport: true },
  );
  await shoot(browser, ownerState, 'N', 'ct-toggle-nyala', beranda, (p) => catat(p), {
    viewport: true,
  });
  await shoot(
    browser,
    ownerState,
    'N',
    'ct-pembagian-sheet',
    beranda,
    (p) =>
      catat(p, async (sheet) => {
        await sheet.getByRole('button', { name: 'Ubah pembagian' }).click();
        // Halaman Pembagian ada di dalam sheet Catat yang sama (bukan dialog baru).
        const radio = p.getByRole('radio', { name: 'Atur nominal' });
        await expect(radio).toBeVisible({ timeout: 15_000 });
        await radio.click();
        await p.getByRole('textbox', { name: /^Bagian Farida/ }).fill('150000');
      }),
    { viewport: true },
  );
  // F belum punya dompet Pribadi: toggle menyala menampilkan pesan.
  await shoot(
    browser,
    partnerState,
    'F',
    'ct-toggle-tanpa-dompet',
    beranda,
    (p) => catat(p),
    { viewport: true },
  );

  await wallet(f, f.psid, 'Jago Farida', 'operasional', 8_000_000);
});

test('tagihan patungan: dua pandangan, riwayat, Lunasi, dialog hapus', { tag: '@screens' }, async ({
  browser,
  ownerState,
  partnerState,
}) => {
  await split(n, 'BCA Novanda', 412_000, 'Listrik Desember');
  await split(n, 'BCA Novanda', 1_250_000, 'Belanja bulanan pasar induk', [
    { user: n.uid, amount: 1_000_000 },
    { user: f.uid, amount: 250_000 },
  ]);
  for (const [user, state] of [
    ['N', ownerState],
    ['F', partnerState],
  ] as const) {
    await shoot(browser, state, user, 'pt-beranda', beranda);
    await shoot(browser, state, user, 'pt-halaman', patungan);
  }
  // Sheet Lunasi (F): normal dan bayar lebih.
  const lunasi = async (p: Page, over: boolean) => {
    const sheet = p.getByRole('dialog', { name: /^Lunasi patungan/ });
    await openUntil(
      () => main(p).getByRole('button', { name: /^Lunasi/ }).first(),
      sheet,
      sheet.getByRole('textbox', { name: 'Jumlah dilunasi' }),
    );
    if (over) await sheet.getByRole('textbox', { name: 'Jumlah dilunasi' }).fill('9000000');
  };
  await shoot(browser, partnerState, 'F', 'pt-sheet-lunasi', patungan, (p) => lunasi(p, false), {
    viewport: true,
  });
  await shoot(browser, partnerState, 'F', 'pt-sheet-lunasi-lebih', patungan, (p) => lunasi(p, true), {
    viewport: true,
  });
  // Dialog hapus tagihan (N).
  await shoot(
    browser,
    ownerState,
    'N',
    'pt-dialog-hapus-tagihan',
    patungan,
    async (p) => {
      const dlg = p.getByRole('alertdialog', { name: 'Hapus tagihan patungan ini?' });
      await openUntil(
        () => main(p).getByRole('button', { name: /^Hapus tagihan patungan Listrik/ }),
        dlg,
      );
    },
    { viewport: true },
  );
});

test('pelunasan: menunggu diterima, Terima, diterima, impas, arah berbalik', { tag: '@screens' }, async ({
  browser,
  ownerState,
  partnerState,
}) => {
  // F melunasi sebagian.
  await asUser(
    f.uid,
    `select api.settle_split(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_amount => 300000::bigint)`,
    [randomUUID(), n.sid, ids[`${f.psid}:Jago Farida`]],
  );
  for (const [user, state] of [
    ['N', ownerState],
    ['F', partnerState],
  ] as const) {
    await shoot(browser, state, user, 'pt-menunggu-beranda', beranda);
    await shoot(browser, state, user, 'pt-menunggu-halaman', patungan);
  }
  await shoot(
    browser,
    ownerState,
    'N',
    'pt-sheet-terima',
    patungan,
    async (p) => {
      const sheet = p.getByRole('dialog', { name: /^Terima pelunasan/ });
      await openUntil(
        () => main(p).getByRole('button', { name: /^Terima/ }).first(),
        sheet,
      );
    },
    { viewport: true },
  );
  await shoot(
    browser,
    partnerState,
    'F',
    'pt-dialog-batal-pelunasan',
    patungan,
    async (p) => {
      const dlg = p.getByRole('alertdialog', { name: 'Batalkan pelunasan ini?' });
      await openUntil(() => main(p).getByRole('button', { name: /^Batalkan pelunasan/ }), dlg);
    },
    { viewport: true },
  );

  // N menerima ke dompetnya.
  const [t] = await adminQuery<{ id: string }>(
    'select id::text from app.settlements where space_id = $1 and voided_at is null limit 1',
    [n.sid],
  );
  await asUser(
    n.uid,
    `select api.receive_settlement(p_client_id => $1, p_settlement_id => $2::uuid, p_account_id => $3)`,
    [randomUUID(), t?.id, ids[`${n.psid}:BCA Novanda`]],
  );
  for (const [user, state] of [
    ['N', ownerState],
    ['F', partnerState],
  ] as const) {
    await shoot(browser, state, user, 'pt-diterima-halaman', patungan);
  }
  await shoot(
    browser,
    ownerState,
    'N',
    'pt-dialog-batal-penerimaan',
    patungan,
    async (p) => {
      const dlg = p.getByRole('alertdialog', { name: 'Batalkan penerimaan?' });
      await openUntil(() => main(p).getByRole('button', { name: /^Batalkan penerimaan/ }), dlg);
    },
    { viewport: true },
  );

  // Impas: F melunasi sisanya.
  await asUser(
    f.uid,
    `select api.settle_split(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_amount => $4::bigint)`,
    [randomUUID(), n.sid, ids[`${f.psid}:Jago Farida`], await owedByF()],
  );
  for (const [user, state] of [
    ['N', ownerState],
    ['F', partnerState],
  ] as const) {
    await shoot(browser, state, user, 'pt-impas-beranda', beranda);
    await shoot(browser, state, user, 'pt-impas-halaman', patungan);
  }

  // Hapus tagihan: arah berbalik (N berutang ke F) dan bagian "Patungan dihapus".
  await asUser(n.uid, `select api.void_split($1, $2::uuid)`, [
    randomUUID(),
    splitIds['Listrik Desember'],
  ]);
  for (const [user, state] of [
    ['N', ownerState],
    ['F', partnerState],
  ] as const) {
    await shoot(browser, state, user, 'pt-berbalik-beranda', beranda);
  }
  await shoot(browser, ownerState, 'N', 'pt-dihapus-terbuka', patungan, async (p) => {
    await main(p).locator('details').filter({ hasText: /Patungan dihapus/ }).locator('summary').click();
  });
  await shoot(browser, partnerState, 'F', 'pt-berbalik-halaman', patungan);

  // Nominal besar.
  await wallet(n, n.psid, 'Rekening Besar Novanda Dengan Nama Panjang Sekali Untuk Uji', 'operasional', BIG * 2);
  await split(
    n,
    'Rekening Besar Novanda Dengan Nama Panjang Sekali Untuk Uji',
    BIG,
    'Renovasi rumah dan perabot ruang tamu serta dapur seluruhnya',
  );
  for (const [user, state] of [
    ['N', ownerState],
    ['F', partnerState],
  ] as const) {
    await shoot(browser, state, user, 'pt-besar-beranda', beranda);
    await shoot(browser, state, user, 'pt-besar-halaman', patungan);
  }
  await shoot(
    browser,
    partnerState,
    'F',
    'pt-sheet-lunasi-besar',
    patungan,
    async (p) => {
      const sheet = p.getByRole('dialog', { name: /^Lunasi patungan/ });
      await openUntil(
        () => main(p).getByRole('button', { name: /^Lunasi/ }).first(),
        sheet,
        sheet.getByRole('textbox', { name: 'Jumlah dilunasi' }),
      );
    },
    { viewport: true },
  );
});

test('Tujuan Bersama dua anggota: Dibuat {nama}, banyak keadaan', { tag: '@screens' }, async ({
  browser,
  ownerState,
  partnerState,
}) => {
  await wallet(n, n.sid, 'Tabungan Liburan Bersama', 'tabungan', 3_000_000);
  await shoot(browser, ownerState, 'N', 'tj-bersama-belum-tujuan', '/bersama/rencana?bagian=tujuan');
  await wallet(n, n.sid, 'Dana Darurat Bersama', 'tabungan', 12_000_000);
  await wallet(n, n.sid, 'Tabungan Pendidikan Anak Dengan Nama Panjang Sekali', 'tabungan', 0);
  await asUser(
    n.uid,
    `select api.create_goal(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_name => 'Liburan berdua ke Jepang', p_target_amount => 5000000::bigint, p_target_on => $4::date)`,
    [randomUUID(), n.sid, ids[`${n.sid}:Tabungan Liburan Bersama`], inDays(240)],
  );
  await asUser(
    f.uid,
    `select api.create_goal(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_name => 'Dana darurat keluarga', p_target_amount => 10000000::bigint, p_target_on => null)`,
    [randomUUID(), n.sid, ids[`${n.sid}:Dana Darurat Bersama`]],
  );
  await asUser(
    n.uid,
    `select api.create_goal(p_client_id => $1, p_space_id => $2, p_account_id => $3,
       p_name => 'Biaya sekolah anak pertama dan kedua tahun ajaran baru', p_target_amount => 98765432100::bigint,
       p_target_on => $4::date)`,
    [
      randomUUID(),
      n.sid,
      ids[`${n.sid}:Tabungan Pendidikan Anak Dengan Nama Panjang Sekali`],
      inDays(400),
    ],
  );
  for (const [user, state] of [
    ['N', ownerState],
    ['F', partnerState],
  ] as const) {
    await shoot(browser, state, user, 'tj-bersama-banyak', '/bersama/rencana?bagian=tujuan');
  }
  await shoot(
    browser,
    partnerState,
    'F',
    'tj-bersama-sheet-ubah',
    '/bersama/rencana?bagian=tujuan',
    async (p) => {
      const sheet = p.getByRole('dialog', { name: /^Ubah tujuan/ });
      await openUntil(
        () => main(p).getByRole('button', { name: /^Ubah/ }).first(),
        sheet,
        sheet.getByRole('textbox', { name: /Nama tujuan/ }),
      );
    },
    { viewport: true },
  );
  await shoot(
    browser,
    ownerState,
    'N',
    'tj-bersama-dialog-arsipkan',
    '/bersama/rencana?bagian=tujuan',
    async (p) => {
      const dlg = p.getByRole('alertdialog').or(p.getByRole('dialog', { name: /^Arsipkan/ }));
      await openUntil(() => main(p).getByRole('button', { name: /^Arsipkan/ }).first(), dlg);
    },
    { viewport: true },
  );
});
