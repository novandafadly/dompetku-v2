import { focusRing } from './styles';

/**
 * Segmen tautan untuk Server Component: salinan `segmentTrack`/`segmentItem` di
 * `segmented-control.tsx` (modul `'use client'`). Sengaja tidak dibagi: memindahkannya ke modul
 * bersama menambah byte di bundel rute prototipe (ADR 0002). Ubah keduanya bersama.
 */
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
