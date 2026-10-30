/** Pasangan warna yang wajib lulus WCAG di kedua tema; dibaca oleh contrast.test.ts. */
export interface Pair {
  fg: string;
  bg: string;
  min: number;
  note: string;
}

const TEXT = 4.5;
const NON_TEXT = 3;

const on = (fg: string, backgrounds: string[], min = TEXT): Pair[] =>
  backgrounds.map((bg) => ({ fg, bg, min, note: `${fg} di ${bg}` }));

/** Permukaan tempat teks biasa bisa muncul, termasuk kartu saldo bertint ruang. */
const SURFACES = ['bg', 'surface', 'surface-2', 'space-pribadi-tint', 'space-bersama-tint'];

export const pairs: Pair[] = [
  ...on('text', SURFACES),
  ...on('text-muted', SURFACES),
  // Batas field, chip, dan kontrol; field ada di halaman (bg), baris (surface), dan sheet (surface-2).
  ...on('border', ['bg', 'surface', 'surface-2'], NON_TEXT),
  // Chip terpilih dan toast memakai warna terbalik.
  ...on('bg', ['text']),
  // Tombol Catat/primer dan tombol bahaya.
  ...on('on-accent', ['space-pribadi', 'space-bersama', 'danger']),
  // Tab aktif (bg, surface) dan kartu saldo (tint).
  ...on('space-pribadi', ['bg', 'surface', 'space-pribadi-tint']),
  ...on('space-bersama', ['bg', 'surface', 'space-bersama-tint']),
  ...on('income', SURFACES),
  ...on('danger', SURFACES),
  ...on('warning', SURFACES),
];
