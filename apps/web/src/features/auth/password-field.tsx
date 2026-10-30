'use client';

import { useState } from 'react';
import { TextField } from '@/components/ui/text-field';
import { focusRing } from '@/components/ui/styles';

/**
 * Field kata sandi layar auth tiruan. Tempel tetap boleh (WCAG 3.3.8), tetapi pengelola sandi
 * tidak diajak mengisi atau menyimpan: prototipe tidak boleh menerima kata sandi asli.
 */
export function PasswordField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      label="Kata sandi"
      type={shown ? 'text' : 'password'}
      value={value}
      onChange={onChange}
      autoComplete="off"
      hint="Prototipe: jangan isi kata sandi asli."
      trailing={
        <button
          type="button"
          aria-pressed={shown}
          onClick={() => {
            setShown((s) => !s);
          }}
          className={`min-h-11 min-w-11 shrink-0 rounded-field px-3 text-base font-semibold text-text underline hover:no-underline ${focusRing}`}
        >
          {shown ? 'Sembunyikan' : 'Tampilkan'}
        </button>
      }
    />
  );
}
