'use client';

import { handleRadioArrowKeys } from './radio-keys';
import { focusRing } from './styles';

export interface SegmentItem {
  value: string;
  label: string;
}

export function SegmentedControl({
  items,
  value,
  onChange,
  label,
}: {
  items: SegmentItem[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- fokus ada di segmen (roving tabindex)
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleRadioArrowKeys}
      className="inline-flex max-w-full rounded-field border border-hairline bg-surface p-1"
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(item.value);
            }}
            className={`min-h-11 min-w-0 rounded-field border px-4 text-base ${focusRing} ${
              // Terpilih: lapisan naik + batas + tebal, tidak hanya beda warna.
              selected
                ? 'border-border bg-surface-2 font-semibold text-text'
                : 'border-transparent text-text-muted hover:text-text active:bg-bg'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
