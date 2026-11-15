'use client';

import { type KeyboardEvent } from 'react';
import { handleRadioArrowKeys } from './radio-keys';
import { focusRing } from './styles';

export interface SegmentItem {
  value: string;
  label: string;
}

export const segmentTrack =
  'flex max-w-full gap-0.5 rounded-toast border border-hairline bg-surface-2 p-0.5';

/** Lebih dari tiga segmen tidak muat sebaris di 320 px: dua kolom (S12-TR1). */
const segmentTrackGrid =
  'grid max-w-full grid-cols-2 gap-0.5 rounded-toast border border-hairline bg-surface-2 p-0.5';

export function segmentItem(selected: boolean): string {
  // Terpilih: lapisan naik (surface) + garis border + tebal, tidak hanya beda warna.
  return `flex h-11 min-w-0 flex-1 items-center justify-center rounded-lg border px-3 text-label ${focusRing} ${
    selected
      ? 'border-border bg-surface font-bold text-text'
      : 'border-transparent font-semibold text-text-soft hover-pointer:text-text active:bg-surface'
  }`;
}

/** Pilihan tunggal di formulir (role radiogroup). `value` null: belum ada pilihan, segmen pertama jadi titik masuk Tab. */
export function SegmentedControl({
  items,
  value,
  onChange,
  label,
  labelledBy,
}: {
  items: SegmentItem[];
  value: string | null;
  onChange: (value: string) => void;
  label?: string;
  labelledBy?: string;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- fokus ada di segmen (roving tabindex)
    <div
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      onKeyDown={handleRadioArrowKeys}
      className={items.length > 3 ? segmentTrackGrid : segmentTrack}
    >
      {items.map((item, i) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (value === null && i === 0) ? 0 : -1}
            onClick={() => {
              onChange(item.value);
            }}
            className={segmentItem(selected)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/** Tab tampilan (role tablist): panah kiri/kanan pindah tab, panel diberi id oleh pemanggil. */
export function Tabs({
  items,
  value,
  onChange,
  label,
  idBase,
}: {
  items: SegmentItem[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  idBase: string;
}) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const forward = e.key === 'ArrowRight';
    if (!forward && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = items.findIndex((t) => t.value === value);
    const next = items[(i + (forward ? 1 : -1) + items.length) % items.length];
    if (!next) return;
    onChange(next.value);
    document.getElementById(`${idBase}-tab-${next.value}`)?.focus();
  }
  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- fokus ada di tab (roving tabindex)
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={segmentTrack}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            id={`${idBase}-tab-${item.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idBase}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(item.value);
            }}
            className={segmentItem(selected)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
