/**
 * Pasangan warna yang wajib lulus WCAG di kedua tema; dibaca oleh contrast.test.ts.
 * `handoff` = rasio yang tertulis di docs/design/panel-malam (Spesifikasi), [gelap, terang];
 * diuji sampai satu desimal agar token tidak bergeser diam-diam dari handoff.
 */
export interface Pair {
  fg: string;
  bg: string;
  min: number;
  /** Rasio tertulis di handoff untuk [gelap, terang]; null bila handoff tidak menyebutnya. */
  handoff?: [number | null, number | null];
  /** Tema tempat pasangan ini dipakai; bawaan keduanya. */
  only?: 'light';
  note: string;
}

const TEXT = 4.5;
const NON_TEXT = 3;

function pair(
  fg: string,
  bg: string,
  min: number,
  handoff?: [number | null, number | null],
  only?: 'light',
): Pair {
  return {
    fg,
    bg,
    min,
    note: `${fg} di ${bg} (${min === TEXT ? 'teks' : 'non-teks'})`,
    ...(handoff ? { handoff } : {}),
    ...(only ? { only } : {}),
  };
}

export const pairs: Pair[] = [
  // Teks utama, sekunder, dan metadata di semua lapisan.
  pair('text', 'bg', TEXT, [16.5, 16.4]),
  pair('text', 'surface', TEXT, [14.6, 17.8]),
  pair('text', 'surface-2', TEXT, [13.0, 15.3]),
  pair('text', 'surface-3', TEXT),
  pair('text', 'hover', TEXT),
  pair('text', 'tab', TEXT),
  pair('text-soft', 'bg', TEXT, [12.1, 9.6]),
  pair('text-soft', 'surface', TEXT, [10.7, 10.4]),
  pair('text-soft', 'surface-2', TEXT, [9.5, 9.0]),
  pair('text-soft', 'tab', TEXT),
  pair('text-muted', 'bg', TEXT, [7.4, 6.0]),
  pair('text-muted', 'surface', TEXT, [6.6, 6.5]),
  pair('text-muted', 'surface-2', TEXT, [5.8, 5.6]),
  pair('text-muted', 'tab', TEXT),
  pair('text-muted', 'hover', TEXT),
  // Tombol primer, Catat, pil ruang aktif.
  pair('on-accent', 'accent', TEXT, [13.8, 13.8]),
  pair('on-pribadi', 'pribadi-fill', TEXT, [13.8, 13.8]),
  pair('on-bersama', 'bersama-fill', TEXT, [8.4, 6.7]),
  pair('on-danger', 'danger', TEXT, [8.7, 6.0]),
  // Tautan, ikon tab aktif, total aman.
  pair('accent-text', 'bg', TEXT, [14.2, 5.8]),
  pair('accent-text', 'surface', TEXT, [12.6, 6.3]),
  pair('accent-text', 'surface-2', TEXT),
  pair('accent-text', 'tab', TEXT),
  pair('accent-text', 'accent-tint', TEXT),
  // Status.
  pair('income', 'bg', TEXT, [10.6, 4.9]),
  pair('income', 'surface', TEXT, [9.4, 5.3]),
  pair('danger', 'bg', TEXT),
  pair('danger', 'surface', TEXT, [7.5, 6.0]),
  pair('danger', 'surface-2', TEXT),
  pair('danger', 'danger-tint', TEXT, [6.8, 5.0]),
  pair('warning', 'bg', TEXT),
  pair('warning', 'surface', TEXT, [9.0, 5.4]),
  pair('warning', 'warning-tint', TEXT, [7.7, 4.8]),
  // Warna ruang: label, tag, chip terpilih, judul Catat.
  pair('pribadi', 'surface', TEXT, [12.6, 6.3]),
  pair('pribadi', 'pribadi-tint', TEXT, [10.4, 5.5]),
  pair('bersama', 'surface', TEXT, [7.7, 6.7]),
  pair('bersama', 'bersama-tint', TEXT, [6.7, 5.6]),
  pair('bersama', 'surface-3', TEXT),
  // Toast dibalik dari tema.
  pair('toast-text', 'toast-bg', TEXT, [16.5, 16.4]),
  pair('toast-action', 'toast-bg', TEXT, [6.9, 13.4]),
  // Batas kontrol (input, chip, tombol sekunder, IconButton) dan cincin fokus.
  pair('border', 'bg', NON_TEXT, [4.5, 3.4]),
  pair('border', 'surface', NON_TEXT, [4.0, 3.7]),
  pair('border', 'surface-2', NON_TEXT),
  pair('border', 'tab', NON_TEXT),
  pair('focus', 'bg', NON_TEXT, [14.2, 6.8]),
  pair('focus', 'surface', NON_TEXT, [12.6, 7.4]),
  pair('focus', 'surface-2', NON_TEXT),
  // Tema terang: lime tidak terbaca di latar terang, jadi tombol primer diberi garis accent-edge.
  pair('accent-edge', 'bg', NON_TEXT, [null, 5.8], 'light'),
  pair('accent-edge', 'surface', NON_TEXT, [null, 6.3], 'light'),
  pair('accent-edge', 'tab', NON_TEXT, undefined, 'light'),
];
