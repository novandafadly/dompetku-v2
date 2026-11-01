'use client';

import { useId, useState } from 'react';

/**
 * Enam kotak 56 px di atas satu input nyata bernama `code` (tempel, isi otomatis OTP, dan pembaca
 * layar tetap jalan). Sama dengan pola prototipe Amankan.
 */
export function CodeField({
  value,
  onChange,
  invalid = false,
  describedBy,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="sr-only">
        Kode 6 angka
      </label>
      <div className="relative">
        <div aria-hidden="true" className="grid grid-cols-6 gap-2">
          {Array.from({ length: 6 }, (_, i) => {
            const active = focused && (i === value.length || (value.length === 6 && i === 5));
            return (
              <span
                key={i}
                className={`num flex h-14 items-center justify-center rounded-lg bg-bg text-headline font-extrabold text-text ${
                  active
                    ? 'border-2 border-focus'
                    : invalid
                      ? 'border-2 border-danger'
                      : 'border border-border'
                }`}
              >
                {value[i] ?? ''}
              </span>
            );
          })}
        </div>
        <input
          id={id}
          name="code"
          value={value}
          onChange={(e) => {
            onChange(e.target.value.replace(/\D/g, '').slice(0, 6));
          }}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="absolute inset-0 h-full w-full bg-transparent text-transparent caret-transparent outline-none"
        />
      </div>
    </div>
  );
}
