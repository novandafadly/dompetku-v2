/** Cincin fokus 2 px token focus (base layer juga menyetelnya); dipakai eksplisit agar tidak tertimpa. */
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** Field: 48 px, label di atas, fokus 2 px focus, latar bg agar tampak cekung di kartu dan sheet. */
export const fieldBox =
  'rounded-lg border border-border bg-bg text-text focus-within:border-2 focus-within:border-focus';

/** Kartu daftar (ListCard): surface, hairline, radius 16; tanpa bayangan. */
export const card = 'rounded-xl border border-hairline bg-surface';

/** Kartu utama (AmanCard, kekayaan bersih, dialog): radius 20. */
export const heroCard = 'rounded-2xl border border-hairline bg-surface';

/** Pemisah antarbaris di dalam kartu. */
export const rowDivider = 'border-t border-hairline first:border-t-0';

/** Ubin ikon atau tanggal di kiri baris. */
export const tile =
  'flex shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-soft';

/** Baris yang membuka layar lain: area ketuk selebar kartu, hover pointer saja. */
export const rowLink = `-mx-4 flex min-h-15.5 items-center gap-3 px-4 hover-pointer:bg-hover active:bg-hover ${focusRing}`;

/** Panel sheet: bottom sheet di HP, dialog tengah mulai 600 px. Satu-satunya lapisan berbayangan selain dialog dan toast. */
export const SHEET_PANEL =
  'fixed inset-x-0 bottom-0 z-30 flex max-h-dvh flex-col overflow-hidden rounded-t-sheet border-t border-hairline bg-surface text-text shadow-sheet data-[state=open]:animate-sheet-in tablet:inset-x-auto tablet:top-1/2 tablet:bottom-auto tablet:left-1/2 tablet:w-full tablet:max-w-130 tablet:-translate-x-1/2 tablet:-translate-y-1/2 tablet:rounded-2xl tablet:border tablet:shadow-float';

/** Pegangan sheet (dekoratif), hanya di HP. */
export const SHEET_HANDLE = 'mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border tablet:hidden';

/** Segmen (kontrol pilihan tunggal): jalur dan butir; dipakai juga segmen tautan Server Component. */
export const segmentTrack =
  'flex max-w-full gap-0.5 rounded-toast border border-hairline bg-surface-2 p-0.5';

export function segmentItem(selected: boolean): string {
  // Terpilih: lapisan naik (surface) + garis border + tebal, tidak hanya beda warna.
  return `flex h-11 min-w-0 flex-1 items-center justify-center rounded-lg border px-3 text-label ${focusRing} ${
    selected
      ? 'border-border bg-surface font-bold text-text'
      : 'border-transparent font-semibold text-text-soft hover-pointer:text-text active:bg-surface'
  }`;
}
