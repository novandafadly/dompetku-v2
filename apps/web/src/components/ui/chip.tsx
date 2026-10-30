'use client';

import type { ReactNode } from 'react';
import { handleRadioArrowKeys } from './radio-keys';
import { focusRing } from './styles';

/** Grup pilihan tunggal. Bila belum ada chip terpilih, beri `focusable` pada chip pertama. */
export function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- fokus ada di chip (roving tabindex)
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleRadioArrowKeys}
      className="flex flex-wrap gap-2"
    >
      {children}
    </div>
  );
}

export function Chip({
  selected,
  onSelect,
  disabled,
  focusable = false,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  /** Titik masuk Tab untuk grup tanpa pilihan (roving tabindex). */
  focusable?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected || focusable ? 0 : -1}
      disabled={disabled}
      onClick={onSelect}
      className={`inline-flex min-h-11 items-center rounded-pill border px-4 text-base disabled:cursor-not-allowed disabled:text-text-muted ${focusRing} ${
        selected
          ? 'border-accent bg-accent-tint font-semibold text-text'
          : 'border-border bg-surface text-text hover:bg-surface-2'
      }`}
    >
      {children}
    </button>
  );
}
