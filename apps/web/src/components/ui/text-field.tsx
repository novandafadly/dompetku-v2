'use client';

import { WarningIcon } from '@phosphor-icons/react';
import { useId, type HTMLInputTypeAttribute, type ReactNode, type RefObject } from 'react';

export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  autoComplete,
  inputMode,
  maxLength,
  readOnly,
  trailing,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Pesan galat inline; field ditandai tidak valid. */
  error?: string | undefined;
  hint?: string;
  type?: HTMLInputTypeAttribute;
  autoComplete?: string;
  inputMode?: 'numeric' | 'email' | 'text';
  maxLength?: number;
  readOnly?: boolean;
  /** Kontrol di sisi kanan field, mis. tombol Tampilkan. */
  trailing?: ReactNode;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter((x) => x !== null).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-text-muted">
        {label}
      </label>
      <div
        className={`flex min-h-11 items-center gap-2 rounded-field border bg-surface pl-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${
          error ? 'border-danger' : 'border-border'
        } ${trailing ? 'pr-1' : 'pr-3'}`}
      >
        <input
          id={id}
          ref={inputRef}
          type={type}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          autoComplete={autoComplete}
          inputMode={inputMode}
          maxLength={maxLength}
          readOnly={readOnly}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="min-h-11 w-full min-w-0 bg-transparent text-lg text-text outline-none read-only:text-text-muted"
        />
        {trailing}
      </div>
      {hint ? (
        <p id={hintId} className="text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="flex items-start gap-1 text-sm text-danger">
          <WarningIcon size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
