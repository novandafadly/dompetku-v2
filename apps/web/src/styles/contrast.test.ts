import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pairs } from './token-pairs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(dir, 'tokens.css'), 'utf8');

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name = '', value = ''] of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[name] = value.toUpperCase();
  }
  return out;
}

/** Isi blok `selector { ... }` pertama yang cocok persis (tanpa blok bersarang). */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`blok tidak ditemukan: ${selector}`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

const dark = declarations(block(':root'));
const light = declarations(block(":root[data-theme='light']"));

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

  it('tema gelap memuat nilai DESIGN.md', () => {
    expect(dark).toMatchObject({
      bg: '#0D0E11',
      surface: '#15171C',
      'surface-2': '#1D2027',
      text: '#F2F3F5',
      'text-muted': '#A0A6B2',
      'space-pribadi': '#6CB4FF',
      'space-pribadi-tint': '#132235',
      'space-bersama': '#F4B860',
      'space-bersama-tint': '#2A2113',
      'on-accent': '#0D0E11',
      income: '#5BD69A',
      danger: '#FF7A72',
      warning: '#FF9B5E',
    });
  });

  it('tidak ada tema yang bergantung pada prefers-color-scheme', () => {
    expect(css).not.toContain('prefers-color-scheme');
  });
});

describe.each([
  ['terang', light],
  ['gelap', dark],
] as const)('kontras WCAG tema %s', (_name, theme) => {
  it.each(pairs)('$note', ({ fg, bg, min }) => {
    const f = theme[fg];
    const b = theme[bg];
    if (f === undefined || b === undefined) throw new Error(`token hilang: ${fg} / ${bg}`);
    expect(ratio(f, b)).toBeGreaterThanOrEqual(min);
  });
});
