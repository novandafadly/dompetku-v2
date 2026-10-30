/** Pasangan warna yang wajib lulus WCAG; dibaca oleh contrast.test.ts. */
export interface Pair {
  fg: string;
  bg: string;
  min: number;
  note: string;
}

const TEXT = 4.5;
const NON_TEXT = 3;

const textOn = (fg: string, backgrounds: string[]): Pair[] =>
  backgrounds.map((bg) => ({ fg, bg, min: TEXT, note: `${fg} di ${bg}` }));

export const pairs: Pair[] = [
  ...textOn('text', ['bg', 'surface', 'surface-2', 'space-pribadi-tint', 'space-bersama-tint']),
  ...textOn('text-muted', [
    'bg',
    'surface',
    'surface-2',
    'space-pribadi-tint',
    'space-bersama-tint',
  ]),
  { fg: 'border', bg: 'bg', min: NON_TEXT, note: 'border di bg' },
  { fg: 'border', bg: 'surface', min: NON_TEXT, note: 'border di surface' },
  ...textOn('on-accent', ['space-pribadi', 'space-bersama']),
  ...textOn('space-pribadi', ['space-pribadi-tint', 'surface']),
  ...textOn('space-bersama', ['space-bersama-tint', 'surface']),
  ...textOn('income', ['surface']),
  ...textOn('danger', ['surface']),
  ...textOn('warning', ['surface']),
];
