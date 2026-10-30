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

const light = declarations(block(':root'));
const dark = declarations(block(":root[data-theme='dark']"));
const darkMedia = declarations(block(":root:not([data-theme='light'])"));

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
  it('tema gelap lewat atribut sama dengan lewat prefers-color-scheme', () => {
    expect(darkMedia).toEqual(dark);
  });

  it('memuat nilai Lampiran A.1', () => {
    expect(light.bg).toBe('#F6F4EF');
    expect(light['space-pribadi']).toBe('#2B3F8F');
    expect(light['space-bersama']).toBe('#A3461E');
    expect(dark.bg).toBe('#121210');
    expect(dark['on-accent']).toBe('#121210');
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
