'use client';

import { useId, type ReactNode, type Ref } from 'react';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { CaretDownIcon } from '@/components/ui/icons/caret-down';

/**
 * Select di baris meta Catat (Dompet, Tanggal): 44 px, ikon + nilai + caret. Select bawaan dipakai
 * agar papan ketik dan pembaca layar bekerja seperti biasa; labelnya untuk pembaca layar (ikon sudah menandai).
 */
export function MetaSelect({
  label,
  icon,
  value,
  onChange,
  options,
  dataDate,
  invalid = false,
  describedBy,
  selectRef,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  dataDate?: string;
  /** Galat kolom (S6-C5): border 2 px `danger` + `aria-invalid`. */
  invalid?: boolean;
  describedBy?: string | undefined;
  selectRef?: Ref<HTMLSelectElement>;
}) {
  const id = useId();
  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-soft"
      >
        {icon}
      </span>
      <select
        id={id}
        ref={selectRef}
        data-date={dataDate}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className="h-11 w-full min-w-0 appearance-none truncate rounded-lg border border-border bg-transparent pr-8 pl-9.5 text-label font-semibold text-text hover-pointer:bg-hover aria-invalid:border-2 aria-invalid:border-danger"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-surface text-text">
            {o.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-text-muted"
      >
        <CaretDownIcon size={14} weight="bold" />
      </span>
    </div>
  );
}

/** Dompet tujuan transfer di ruang yang sama; dompet sumber tidak ditawarkan. */
export function DestinationChips({
  accounts,
  value,
  onChange,
}: {
  accounts: { id: string; name: string }[];
  value: string | undefined;
  onChange: (accountId: string) => void;
}) {
  return (
    <ChipGroup label="Ke dompet">
      {accounts.map((a, i) => (
        <Chip
          key={a.id}
          variant="category"
          selected={a.id === value}
          focusable={value === undefined && i === 0}
          onSelect={() => {
            onChange(a.id);
          }}
        >
          {a.name}
        </Chip>
      ))}
    </ChipGroup>
  );
}
