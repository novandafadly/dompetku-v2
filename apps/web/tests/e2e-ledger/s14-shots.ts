import { appendFile } from 'node:fs/promises';
import type { Browser, Locator, Page } from '@playwright/test';
import { expect } from './fixtures';

/**
 * Pembantu screenshot S14 (Delivery Gate): potret 320/390/1280 gelap dan terang dengan audit teks dan
 * warna ke `_audit.jsonl` (kata terlarang S14, `Rp 0`, warna merah/hijau/amber pada teks angka,
 * gulir horizontal). Bukan tes regresi: dipakai spec yang dilewati kecuali `SHOTS_DIR` diisi.
 */

export const WIDTHS = [320, 390, 1280] as const;
export const THEMES = ['dark', 'light'] as const;
export const BASE = 'http://localhost:3301';

export interface Audit {
  name: string;
  w: number;
  theme: string;
  overflow: number;
  banned: string[];
  rpZero: string[];
  coloredNumbers: string[];
}

export async function auditPage(
  page: Page,
  name: string,
  w: number,
  theme: string,
): Promise<Audit> {
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
    const roots = [...document.querySelectorAll('main, [role="dialog"], [role="alertdialog"]')];
    const scan = roots.length > 0 ? roots : [document.body];
    const text = scan.map((el) => (el as HTMLElement).innerText).join('\n');
    const banned = [
      ...text.matchAll(
        /Hutang|hutang|rumah tangga|Goal|goal|Net worth|Portfolio|portofolio|P\/L|holding|ticker|unrealized|!|\.JK|\p{Extended_Pictographic}/gu,
      ),
    ].map((m) => m[0]);
    const rpZero = [...text.matchAll(/.{0,30}Rp\s?0(?![\d.])(?!\s?\/).{0,20}/g)].map((m) => m[0]);
    const colored: string[] = [];
    scan.forEach((root) => {
      root.querySelectorAll<HTMLElement>('*').forEach((el) => {
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent ?? '')
          .join('')
          .trim();
        if (!own || !/(Rp\s?\d|\d+\s?%|Kurang|untung|rugi|berutang|Piutang)/.test(own)) return;
        const c = getComputedStyle(el).color;
        const tag = flagged[c];
        if (tag) colored.push(`${tag}: ${own.slice(0, 70)}`);
      });
    });
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      banned,
      rpZero,
      colored,
    };
  });
  return {
    name,
    w,
    theme,
    overflow: r.overflow,
    banned: r.banned,
    rpZero: r.rpZero,
    coloredNumbers: r.colored,
  };
}

type Act = (p: Page) => Promise<void>;
export interface ShootOpts {
  /** Tangkap viewport saja (sheet/dialog) alih-alih halaman penuh. */
  viewport?: boolean;
  widths?: readonly number[];
  themes?: readonly ('dark' | 'light')[];
}

/** Potret `path` di semua ukuran dan tema; `act` membuka sheet/dialog atau menggulir. */
export function shooter(out: string) {
  const fail = (name: string, e: unknown) =>
    appendFile(`${out}/_failures.txt`, `${name}: ${String(e).split('\n')[0] ?? ''}\n`);
  return async function shoot(
    browser: Browser,
    state: string,
    name: string,
    path: string,
    act?: Act,
    opts: ShootOpts = {},
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
          const audit = await auditPage(page, name, w, theme);
          await appendFile(`${out}/_audit.jsonl`, `${JSON.stringify(audit)}\n`);
          if (opts.viewport !== true) {
            await page.evaluate(() => {
              document
                .querySelectorAll<HTMLElement>('nav[aria-label="Tab utama"]')
                .forEach((el) => {
                  el.style.display = 'none';
                });
            });
            if (w === 1280) {
              const dh = await page.evaluate(() => document.documentElement.scrollHeight);
              await page.setViewportSize({ width: w, height: Math.min(Math.max(h, dh), 3400) });
              await page.waitForTimeout(250);
            }
          }
          await page.screenshot({
            path: `${out}/${name}-${String(w)}-${theme}.png`,
            fullPage: opts.viewport !== true,
            animations: 'disabled',
          });
        } catch (e) {
          await fail(`${name}-${String(w)}-${theme}`, e);
        } finally {
          await context.close();
        }
      }
    }
  };
}

/** Ulangi klik sampai sheet/dialog malas benar-benar tampil. */
export async function openUntil(open: () => Locator, dialog: Locator, field?: Locator) {
  await expect(async () => {
    if ((await dialog.count()) === 0) await open().click();
    await expect(field ?? dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}
