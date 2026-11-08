import { randomUUID } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { asUser, spaceOf } from '../e2e-auth/helpers';
import { adminQuery, expect, OWNER, test } from './fixtures';
import { openCatat } from './helpers';

/**
 * Spesifikasi E2E Web Vitals (IPD §5 S9 & Task 16 plan S9 → Pra-S10 Task 7, keputusan K4):
 * - Rute yang diuji (dengan data terisi):
 *   `/pribadi/beranda`, `/pribadi/transaksi`, `/pribadi/rencana`, `/pribadi/laporan`, `/bersama/beranda`
 * - Pengukuran di 390×844 dengan throttling CDP (CPU 4×, jaringan 4G lambat: RTT 150 ms,
 *   unduh 1,6 Mbps, unggah 750 kbps), diambil median dari 3 muat dingin per rute.
 * - Ambang target: LCP < 2500 ms, INP < 200 ms, CLS < 0,1.
 * - K4: lokal (`!process.env.CI`) = asersi keras memblokir; runner CI bersama (`process.env.CI`) =
 *   anotasi + `::notice`/`::warning` untuk LCP/INP yang sensitif jitter CPU VM bersama, sementara
 *   CLS < 0,1 tetap asersi keras di semua lingkungan.
 */
test.describe.configure({ mode: 'serial' });

const WALLET_PRIBADI = 'Dompet Vitals Pribadi';
const WALLET_BERSAMA = 'Kas Vitals Bersama';
const BILL_PRIBADI = 'Internet Vitals Pribadi';

interface VitalsSample {
  lcp: number;
  inp: number;
  cls: number;
}

declare global {
  interface Window {
    __vitals?: VitalsSample;
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function seedSpace(kind: 'personal' | 'shared', walletName: string): Promise<void> {
  const { uid, sid } = await spaceOf(OWNER, kind);
  const [existingWallet] = await adminQuery<{ id: string }>(
    'select id from app.accounts where space_id = $1 and name = $2',
    [sid, walletName],
  );
  let accountId = existingWallet?.id;
  if (!accountId) {
    const [created] = await asUser<{ id: string }>(
      uid,
      `select (api.create_account(p_client_id => $1, p_space_id => $2, p_name => $3,
         p_pocket => 'operasional', p_wallet_type => 'bank', p_opening_balance => 10000000::bigint) ->> 'account_id') as id`,
      [randomUUID(), sid, walletName],
    );
    accountId = created?.id;
  }
  if (!accountId) throw new Error('gagal menyiapkan dompet vitals');

  const cats = await asUser<{ id: string; type: string; name: string }>(
    uid,
    `select id, type::text as type, name from app.categories
      where space_id = $1 and parent_id is null and archived_at is null
      order by sort_order`,
    [sid],
  );
  const expCat = cats.find((c) => c.type === 'expense');
  const expCat2 = cats.filter((c) => c.type === 'expense')[1] ?? expCat;
  const incCat = cats.find((c) => c.type === 'income');
  if (!expCat || !expCat2 || !incCat) throw new Error('kategori vitals tidak lengkap');

  const [existingEntry] = await adminQuery<{ id: string }>(
    "select id from app.entries where space_id = $1 and description = 'Belanja Vitals 1'",
    [sid],
  );
  if (!existingEntry) {
    await asUser(
      uid,
      `select api.create_entry(p_client_id => $1, p_space_id => $2, p_account_id => $3,
         p_kind => 'income', p_amount => 8500000::bigint, p_category_id => $4, p_description => 'Gaji Vitals')`,
      [randomUUID(), sid, accountId, incCat.id],
    );
    for (let i = 1; i <= 4; i++) {
      await asUser(
        uid,
        `select api.create_entry(p_client_id => $1, p_space_id => $2, p_account_id => $3,
           p_kind => 'expense', p_amount => $4::bigint, p_category_id => $5, p_description => $6)`,
        [randomUUID(), sid, accountId, i * 125_000, expCat.id, `Belanja Vitals ${String(i)}`],
      );
    }
  }

  const [period] = await adminQuery<{ label: string }>(
    'select label_month::text as label from app.pay_period($1, app.today())',
    [sid],
  );
  if (period?.label) {
    await asUser(
      uid,
      'select api.set_budget($1, $2, $3::date, 600000::bigint, false)',
      [sid, expCat.id, period.label],
    );
  }

  if (kind === 'personal' && expCat2.id !== expCat.id) {
    const [existingBill] = await adminQuery<{ id: string }>(
      'select id from app.bills where space_id = $1 and name = $2',
      [sid, BILL_PRIBADI],
    );
    if (!existingBill) {
      await asUser(
        uid,
        `select api.create_bill($1, $2, $3, 350000::bigint, $4, 20::smallint, app.today(), null, $5)`,
        [randomUUID(), sid, BILL_PRIBADI, expCat2.id, accountId],
      );
    }
  }
}

async function interactOnRoute(page: Page, path: string): Promise<void> {
  const main = page.getByRole('main');
  if (path.endsWith('/rencana')) {
    const row = main.locator('[data-budget-row]').first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByRole('dialog', { name: /^Anggaran/ })).toBeVisible();
    await page.keyboard.press('Escape');
    return;
  }
  await openCatat(page);
  await page.keyboard.press('Escape');
}

async function measureOnce(
  browser: Browser,
  ownerState: string,
  path: string,
): Promise<VitalsSample> {
  const context = await browser.newContext({
    storageState: ownerState,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: Math.floor((1.6 * 1024 * 1024) / 8),
      uploadThroughput: Math.floor((750 * 1024) / 8),
    });

    await page.addInitScript(() => {
      const state: VitalsSample = { lcp: 0, inp: 0, cls: 0 };
      window.__vitals = state;
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            state.lcp = e.startTime;
          }
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch {
        // abaikan bila tipe tidak didukung
      }
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as (PerformanceEntry & {
            hadRecentInput?: boolean;
            value?: number;
          })[]) {
            if (!e.hadRecentInput && typeof e.value === 'number') {
              state.cls += e.value;
            }
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {
        // abaikan bila tipe tidak didukung
      }
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.duration > state.inp) state.inp = e.duration;
          }
        }).observe({
          type: 'event',
          buffered: true,
          durationThreshold: 0,
        } as PerformanceObserverInit);
      } catch {
        // abaikan bila tipe tidak didukung
      }
    });

    const response = await page.goto(path, { waitUntil: 'networkidle' });
    expect(response?.status(), path).toBe(200);
    await expect(page.getByRole('main')).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((r) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              r();
            });
          });
        }),
    );
    const loadVitals = await page.evaluate(() => ({
      lcp: window.__vitals?.lcp ?? 0,
      cls: window.__vitals?.cls ?? 0,
    }));

    await interactOnRoute(page, path);
    await page.evaluate(
      () =>
        new Promise<void>((r) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              r();
            });
          });
        }),
    );
    const afterVitals = await page.evaluate(() => ({
      lcp: window.__vitals?.lcp ?? 0,
      inp: window.__vitals?.inp ?? 0,
      cls: window.__vitals?.cls ?? 0,
    }));

    return {
      lcp: loadVitals.lcp > 0 ? loadVitals.lcp : afterVitals.lcp,
      inp: afterVitals.inp,
      cls: Math.max(loadVitals.cls, afterVitals.cls),
    };
  } finally {
    await context.close();
  }
}

test.beforeAll(async () => {
  await seedSpace('personal', WALLET_PRIBADI);
  await seedSpace('shared', WALLET_BERSAMA);
});

const ROUTES = [
  '/pribadi/beranda',
  '/pribadi/transaksi',
  '/pribadi/rencana',
  '/pribadi/laporan',
  '/bersama/beranda',
] as const;

for (const path of ROUTES) {
  test(`Web Vitals 390x844 throttle 4x CPU + 4G (${path})`, async ({ browser, ownerState }) => {
    test.setTimeout(120_000);
    const samples: VitalsSample[] = [];
    for (let i = 0; i < 3; i++) {
      samples.push(await measureOnce(browser, ownerState, path));
    }
    const lcp = median(samples.map((s) => s.lcp));
    const inp = median(samples.map((s) => s.inp));
    const cls = median(samples.map((s) => s.cls));

    test.info().annotations.push(
      { type: 'lcp-ms', description: lcp.toFixed(0) },
      { type: 'inp-ms', description: inp.toFixed(0) },
      { type: 'cls', description: cls.toFixed(3) },
    );

    expect(lcp, `LCP harus terukur di ${path}`).toBeGreaterThan(0);
    expect(cls, `CLS < 0.1 di ${path}`).toBeLessThan(0.1);

    if (process.env.CI) {
      // K4: runner CI bersama mencatat notice/warning untuk LCP/INP yang sensitif jitter CPU VM.
      console.log(
        `::notice title=Web Vitals ${path}::LCP=${lcp.toFixed(0)}ms INP=${inp.toFixed(0)}ms CLS=${cls.toFixed(3)}`,
      );
      if (lcp >= 2500 || inp >= 200) {
        console.log(
          `::warning title=Web Vitals melewati ambang di runner CI (${path})::LCP=${lcp.toFixed(0)}ms (batas 2500ms), INP=${inp.toFixed(0)}ms (batas 200ms), CLS=${cls.toFixed(3)} (batas 0.1)`,
        );
      }
    } else {
      expect(lcp, `LCP < 2500 ms di ${path}`).toBeLessThan(2500);
      expect(inp, `INP < 200 ms di ${path}`).toBeLessThan(200);
    }
  });
}
