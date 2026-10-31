'use client';

import { useState } from 'react';
import { EyeIcon } from '@/components/ui/icons/eye';
import { EyeSlashIcon } from '@/components/ui/icons/eye-slash';
import { focusRing } from '@/components/ui/styles';
import { TextField } from '@/components/ui/text-field';

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
      placeholder="Kata sandi"
      autoComplete="off"
      hint="Prototipe: jangan isi kata sandi asli."
      hintTone="warning"
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
