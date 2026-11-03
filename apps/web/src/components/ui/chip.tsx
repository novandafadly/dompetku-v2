'use client';

import type { ReactNode, Ref } from 'react';
import { CheckIcon } from './icons/check';
import { handleRadioArrowKeys } from './radio-keys';

/** Grup pilihan tunggal. Bila belum ada chip terpilih, beri `focusable` pada chip pertama. */
export function ChipGroup({
  label,
  className = 'flex flex-wrap gap-2',
  invalid = false,
  describedBy,
  children,
}: {
  label: string;
  className?: string;
  /** Galat pilihan (mis. kategori diarsipkan): `aria-invalid` + `aria-describedby`. */
  invalid?: boolean;
  describedBy?: string | undefined;
  children: ReactNode;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- fokus ada di chip (roving tabindex)
    <div
      role="radiogroup"
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onKeyDown={handleRadioArrowKeys}
      className={className}
    >
      {children}
    </div>
  );
}

export type ChipVariant = 'category' | 'filter';

// Cincin offset 0: chip sering ada di baris yang digeser (overflow), cincin tidak boleh terpotong.
const base = `inline-flex h-11 shrink-0 items-center gap-1.5 border text-label whitespace-nowrap disabled:border-hairline disabled:text-text-muted aria-disabled:border-hairline aria-disabled:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus`;

const variants: Record<ChipVariant, { shape: string; on: string; off: string }> = {
  // Kategori: terpilih = tint ruang + garis 1,5 px warna ruang + ✓ (bukan warna saja).
  category: {
    shape: 'rounded-lg px-3.5',
    on: 'border-1.5 border-ruang bg-ruang-tint font-bold text-ruang',
    off: 'border-border font-semibold text-text hover-pointer:bg-hover active:bg-surface-2',
  },
  // Filter: pil, aktif = warna dibalik + ✓.
  filter: {
    shape: 'rounded-full px-4',
    on: 'border-text bg-text font-bold text-bg',
    off: 'border-border font-semibold text-text hover-pointer:bg-hover active:bg-surface-2',
  },
};

export function Chip({
  selected,
  onSelect,
  disabled,
  ariaDisabled = false,
  focusable = false,
  variant = 'filter',
  icon,
  buttonRef,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  /** Nonaktif sementara tanpa melepas fokus (mis. selama menyimpan): klik diabaikan. */
  ariaDisabled?: boolean;
  /** Titik masuk Tab untuk grup tanpa pilihan (roving tabindex). */
  focusable?: boolean;
  variant?: ChipVariant;
  /** Ikon di kiri (kategori di dialog laptop); diganti ✓ saat terpilih. Pemanggil mengatur tampil/warnanya. */
  icon?: ReactNode;
  /** Ref ke tombol (mis. untuk mengembalikan fokus sesudah halaman dalam sheet ditutup). */
  buttonRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  const v = variants[variant];
  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected || focusable ? 0 : -1}
      disabled={disabled}
      aria-disabled={ariaDisabled || undefined}
      onClick={ariaDisabled ? undefined : onSelect}
      className={`${base} ${v.shape} ${selected ? v.on : v.off}`}
    >
      {selected ? (
        <CheckIcon size={16} weight="bold" className="shrink-0" />
      ) : icon ? (
        <span aria-hidden="true" className="contents">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}
