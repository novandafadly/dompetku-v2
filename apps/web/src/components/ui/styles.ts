/** Cincin fokus bersama: warna teks (bukan aksen ruang), >= 3:1 di semua permukaan kedua tema. */
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text';

/** Field: lapisan surface di halaman, tampak cekung di sheet (surface-2). */
export const fieldBox =
  'rounded-field border border-border bg-surface text-text focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-text';

/** Daftar datar di lapisan surface: baris dipisah hairline, tanpa bayangan. */
export const listBlock = 'rounded-card bg-surface px-4';
export const listRow = 'border-b border-hairline last:border-b-0';

/** Baris yang membuka layar lain: area ketuk selebar blok, umpan balik hover/tekan. */
export const rowLink =
  '-mx-4 flex min-h-15 items-center justify-between gap-3 rounded-card px-4 py-2 hover:bg-surface-2 active:bg-bg';

/** Latar judul = ruang tujuan (wajib di ui-ux.md): mencegah salah catat ke ruang lain. */
export const tints = {
  pribadi: 'bg-pribadi-tint',
  bersama: 'bg-bersama-tint',
} as const;

/** Panel sheet: lapisan tertinggi (surface-2), satu-satunya tempat bayangan selain dialog. */
export const SHEET_PANEL =
  'fixed inset-x-0 bottom-0 z-20 flex max-h-dvh flex-col overflow-hidden rounded-t-sheet border-t border-hairline bg-surface-2 text-text shadow-sheet data-[state=open]:animate-sheet-in dialog:inset-x-auto dialog:top-1/2 dialog:bottom-auto dialog:left-1/2 dialog:w-full dialog:max-w-lg dialog:-translate-x-1/2 dialog:-translate-y-1/2 dialog:rounded-sheet dialog:border dialog:shadow-dialog';

export const SHEET_HEADER = 'flex min-h-13 items-center gap-2 border-b border-hairline pl-4';
