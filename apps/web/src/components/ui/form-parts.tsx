'use client';

import { useId } from 'react';
import { FieldLabel } from '@/components/ui/field';
import { FieldError, FieldHint } from '@/components/ui/field-messages';
import { CaretDownIcon } from '@/components/ui/icons/caret-down';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';

/**
 * Bagian formulir bersama sheet (Rencana, Utang) (galat kotak atas, `<select>` berlabel, dompet
 * yang boleh dipakai). Dipisah dari `bill-sheet.tsx` supaya sheet Utang tidak membawa seluruh
 * sheet Tagihan ke chunknya (budget JS).
 */

export function Alert({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-lg bg-danger-tint p-3 text-label font-semibold text-danger"
    >
      <p className="flex items-start gap-2">
        <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" />
        <span className="text-pretty">{children}</span>
      </p>
      {action}
    </div>
  );
}

const SELECT =
  'h-12 w-full min-w-0 appearance-none truncate rounded-lg border border-border bg-bg pr-9 pl-3.5 text-body font-medium text-text hover-pointer:bg-hover disabled:border-hairline disabled:text-text-muted aria-invalid:border-2 aria-invalid:border-danger';

/** `<select>` bawaan berlabel terlihat + caret; galat kolom `role="alert"`. */
export function SelectField({
  label,
  value,
  onChange,
  error,
  hint,
  selectRef,
  busy,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
  selectRef?: React.RefObject<HTMLSelectElement | null> | undefined;
  busy: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-e`;
  const hintId = `${id}-h`;
  const describedBy =
    [hint === undefined ? null : hintId, error === undefined ? null : errorId]
      .filter((x) => x !== null)
      .join(' ') || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <select
          id={id}
          ref={selectRef}
          value={value}
          aria-invalid={error !== undefined || undefined}
          aria-describedby={describedBy}
          aria-disabled={busy || undefined}
          onChange={(e) => {
            if (!busy) onChange(e.target.value);
          }}
          className={SELECT}
        >
          {children}
        </select>
        <CaretDownIcon
          size={16}
          weight="bold"
          className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-text-soft"
        />
      </div>
      {error === undefined ? null : (
        <div role="alert">
          <FieldError id={errorId}>{error}</FieldError>
        </div>
      )}
      {hint === undefined ? null : <FieldHint id={hintId}>{hint}</FieldHint>}
    </div>
  );
}
