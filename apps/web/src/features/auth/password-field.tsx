'use client';

import { useState } from 'react';
import { TextField } from '@/components/ui/text-field';
import { focusRing } from '@/components/ui/styles';

/** Field kata sandi yang boleh ditempel dan diisi otomatis (WCAG 3.3.8). */
export function PasswordField({
  value,
  onChange,
  autoComplete,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
}) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      label="Kata sandi"
      type={shown ? 'text' : 'password'}
      value={value}
      onChange={onChange}
      autoComplete={autoComplete}
      trailing={
        <button
          type="button"
          aria-pressed={shown}
          onClick={() => {
            setShown((s) => !s);
          }}
          className={`min-h-11 min-w-11 rounded-field px-3 text-base text-accent underline ${focusRing}`}
        >
          {shown ? 'Sembunyikan' : 'Tampilkan'}
        </button>
      }
    />
  );
}
