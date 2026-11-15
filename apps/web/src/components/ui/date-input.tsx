'use client';

import { shortDateLabel } from '@dompetku/domain';
import { useId, type RefObject } from 'react';
import { FieldLabel, fieldShell } from './field';
import { FieldError } from './field-messages';

/** `<input type="date">` berlabel + teks pasti (pemilih tanggal browser memakai format lokal). */
export function DateInput({
  label,
  value,
  onChange,
  max,
  min,
  error,
  busy,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: string;
  min?: string;
  error?: string | undefined;
  busy: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  const errorId = `${id}-e`;
  const textId = `${id}-t`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className={`${fieldShell(error !== undefined)} px-3.5`}>
        <input
          id={id}
          ref={inputRef}
          type="date"
          value={value}
          min={min ?? '2020-01-01'}
          max={max}
          aria-invalid={error !== undefined || undefined}
          aria-describedby={error === undefined ? textId : `${textId} ${errorId}`}
          aria-disabled={busy || undefined}
          onChange={(e) => {
            if (!busy) onChange(e.target.value);
          }}
          className="min-h-11 w-full min-w-0 bg-transparent text-body font-medium text-text outline-none"
        />
      </div>
      <p id={textId} className="text-meta font-semibold text-text-soft">
        {value === '' ? 'Belum diisi' : `${shortDateLabel(value)} ${value.slice(0, 4)}`}
      </p>
      {error === undefined ? null : (
        <div role="alert">
          <FieldError id={errorId}>{error}</FieldError>
        </div>
      )}
    </div>
  );
}
