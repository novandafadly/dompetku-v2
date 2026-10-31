import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pairs } from './token-pairs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(dir, 'tokens.css'), 'utf8');

type Tokens = Record<string, string>;

function declarations(body: string): Tokens {
  const out: Tokens = {};
  for (const [, name = '', value = ''] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    out[name] = value.trim().toUpperCase();
  }
  return out;
}

/** Isi blok `selector { ... }` pertama yang cocok persis (tanpa blok bersarang). */
function block(selector: string): Tokens {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`blok tidak ditemukan: ${selector}`);
  const open = css.indexOf('{', start);
  return declarations(css.slice(open + 1, css.indexOf('}', open)));
}

const dark = block(":root,\n[data-theme='dark']");
const light = block("[data-theme='light']");
const system = block("  [data-theme='system']");

/** Nilai handoff (docs/design/panel-malam/README.md, tabel Design tokens). */
const HANDOFF: Record<string, [string, string]> = {
  bg: ['#0F1211', '#F4F6F3'],
  surface: ['#1A1F1D', '#FFFFFF'],
  'surface-2': ['#232927', '#EBEFEA'],
  'surface-3': ['#2C3330', '#E1E6E0'],
  text: ['#EDF1EE', '#141917'],
  'text-soft': ['#C9D1CD', '#38423D'],
  'text-muted': ['#9BA5A0', '#56605B'],
  border: ['#737E79', '#7D8782'],
  hairline: ['#262C2A', '#DDE2DE'],
  accent: ['#C4EE6A', '#C4EE6A'],
  'accent-hover': ['#D3F58C', '#B5E54F'],
  'accent-press': ['#B0DB52', '#A5D63E'],
  'accent-edge': ['TRANSPARENT', '#4A6A0F'],
  'on-accent': ['#11160A', '#11160A'],
  'accent-text': ['#C4EE6A', '#4A6A0F'],
  'accent-tint': ['#26301A', '#E8F6C8'],
  income: ['#5FD8A4', '#1B7A4B'],
  danger: ['#FF8F7D', '#B8322A'],
  'danger-tint': ['#3A201C', '#FBE6E3'],
  'on-danger': ['#1A0905', '#FFFFFF'],
  warning: ['#F0B44C', '#9A5B00'],
  'warning-tint': ['#33290F', '#FBEFD9'],
  pribadi: ['#C4EE6A', '#4A6A0F'],
  'pribadi-tint': ['#26301A', '#E8F6C8'],
  'pribadi-fill': ['#C4EE6A', '#C4EE6A'],
  'on-pribadi': ['#11160A', '#11160A'],
  bersama: ['#B6A3FF', '#5B45C9'],
  'bersama-tint': ['#2A2540', '#ECE8FF'],
  'bersama-fill': ['#B6A3FF', '#5B45C9'],
  'on-bersama': ['#160F33', '#FFFFFF'],
  focus: ['#C4EE6A', '#3F5F0A'],
  'toast-bg': ['#EDF1EE', '#141917'],
  'toast-text': ['#0F1211', '#F4F6F3'],
  'toast-action': ['#3D5A0A', '#C4EE6A'],
  scrim: ['RGB(4 6 5 / 0.66)', 'RGB(20 25 23 / 0.42)'],
  tab: ['#141816', '#FFFFFF'],
  hover: ['#212725', '#F0F3EF'],
  'chart-aman': ['#C4EE6A', '#7FAE2A'],
  'chart-tagihan': ['#F0B44C', '#D99A2B'],
  'chart-tagihan-2': ['#B8862F', '#B07A1C'],
  'chart-wajib': ['#FF8F7D', '#D9564B'],
};

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

describe('tokens.css', () => {
  it('tema terang mendefinisikan ulang setiap token tema gelap', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });

  it('"Ikuti sistem" (prefers-color-scheme: light) sama persis dengan tema terang', () => {
    expect(css).toContain('@media (prefers-color-scheme: light)');
    expect(system).toEqual(light);
  });

  it.each(Object.entries(HANDOFF))('%s sama dengan handoff di kedua tema', (name, [d, l]) => {
    expect(dark[name]).toBe(d);
    expect(light[name]).toBe(l);
  });
});

describe.each([
  ['gelap', dark, 0],
  ['terang', light, 1],
] as const)('kontras WCAG tema %s', (name, theme, index) => {
  const applicable = pairs.filter((p) => p.only === undefined || name === 'terang');
  it.each(applicable)('$note', ({ fg, bg, min, handoff }) => {
    const f = theme[fg];
    const b = theme[bg];
    if (f === undefined || b === undefined) throw new Error(`token hilang: ${fg} / ${bg}`);
    const r = ratio(f, b);
    expect(r).toBeGreaterThanOrEqual(min);
    const stated = handoff?.[index];
    if (typeof stated === 'number') expect(Math.abs(r - stated)).toBeLessThan(0.06);
  });
});
