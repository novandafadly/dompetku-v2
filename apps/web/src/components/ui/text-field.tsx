'use client';

import { useId, type HTMLInputTypeAttribute, type ReactNode, type RefObject } from 'react';
import { FieldError, FieldHint, FieldLabel, fieldShell } from './field';

export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  hintTone = 'muted',
  placeholder,
  optional,
  type = 'text',
  autoComplete,
  inputMode,
  maxLength,
  readOnly,
  trailing,
  inputRef,
  name,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Pesan galat inline; field ditandai tidak valid. */
  error?: string | undefined;
  hint?: string;
  hintTone?: 'muted' | 'warning';
  placeholder?: string;
  optional?: boolean;
  type?: HTMLInputTypeAttribute;
  autoComplete?: string;
  inputMode?: 'numeric' | 'email' | 'text';
  maxLength?: number;
  readOnly?: boolean;
  /** Kontrol di sisi kanan field, mis. tombol Tampilkan. */
  trailing?: ReactNode;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Nama field form (Server Action membaca FormData). */
  name?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter((x) => x !== null).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id} optional={optional === true}>
        {label}
      </FieldLabel>
      <div className={`${fieldShell(Boolean(error))} pl-3.5 ${trailing ? 'pr-0.5' : 'pr-3.5'}`}>
        <input
          id={id}
          name={name}
          ref={inputRef}
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          autoComplete={autoComplete}
          inputMode={inputMode}
          maxLength={maxLength}
          readOnly={readOnly}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="min-h-11 w-full min-w-0 bg-transparent text-body font-medium text-text outline-none placeholder:text-text-muted read-only:text-text-muted"
        />
        {trailing}
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      {hint ? (
        <FieldHint id={hintId} tone={hintTone}>
          {hint}
        </FieldHint>
      ) : null}
    </div>
  );
}
