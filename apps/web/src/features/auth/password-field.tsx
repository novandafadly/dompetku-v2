'use client';

import { useState } from 'react';
import { EyeIcon } from '@/components/ui/icons/eye';
import { EyeSlashIcon } from '@/components/ui/icons/eye-slash';
import { focusRing } from '@/components/ui/styles';
import { TextField } from '@/components/ui/text-field';

/**
 * Field kata sandi layar auth. Tempel tetap boleh (WCAG 3.3.8). Di prototipe pengelola sandi
 * tidak diajak mengisi atau menyimpan (tidak boleh menerima kata sandi asli); di mode nyata
 * `autoComplete` diisi (`current-password`/`new-password`) agar pengelola sandi bekerja.
 */
export function PasswordField({
  value,
  onChange,
  label = 'Kata sandi',
  error,
  name,
  autoComplete,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  error?: string | undefined;
  name?: string;
  /** Diisi = mode nyata (tanpa peringatan prototipe). */
  autoComplete?: 'current-password' | 'new-password';
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      label={label}
      error={error}
      type={shown ? 'text' : 'password'}
      value={value}
      onChange={onChange}
      placeholder={label}
      {...(name === undefined ? {} : { name })}
      autoComplete={autoComplete ?? 'off'}
      {...(autoComplete === undefined
        ? { hint: 'Prototipe: jangan isi kata sandi asli.', hintTone: 'warning' as const }
        : hint === undefined
          ? {}
          : { hint })}
      trailing={
        <button
          type="button"
          aria-pressed={shown}
          aria-label="Tampilkan kata sandi"
          onClick={() => {
            setShown((s) => !s);
          }}
          className={`flex size-11 shrink-0 items-center justify-center rounded-md text-text-soft hover-pointer:bg-hover ${focusRing}`}
        >
          {shown ? <EyeSlashIcon size={20} /> : <EyeIcon size={20} />}
        </button>
      }
    />
  );
}
