'use client';

import {
  useId,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type RefObject,
} from 'react';
import { formatRibuan, parseRupiah, type Rupiah } from '@dompetku/domain';

function display(value: Rupiah | null): string {
  return value === null ? '' : formatRibuan(value);
}

const digitsOf = (text: string) => text.replace(/\D/g, '');

/** Indeks di `text` tepat setelah `count` angka (titik pemisah dilewati). */
function caretAfterDigits(text: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (/\d/.test(text.charAt(i))) seen++;
    if (seen === count) return i + 1;
  }
  return text.length;
}

export function MoneyInput({
  value,
  onChange,
  label,
  disabled,
  labelHidden = false,
  inputMode = 'numeric',
  size = 'base',
  inputRef: externalRef,
}: {
  value: Rupiah | null;
  onChange: (value: Rupiah | null) => void;
  label: string;
  disabled?: boolean;
  /** Label hanya untuk pembaca layar, bila awalan "Rp" dan konteks sudah menjelaskan field. */
  labelHidden?: boolean;
  /** 'none' untuk keypad dalam aplikasi: keyboard OS tidak muncul, keyboard fisik tetap jalan. */
  inputMode?: 'numeric' | 'none';
  size?: 'base' | 'hero';
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  const ownRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? ownRef;
  // Jumlah angka di kiri caret yang harus dipertahankan setelah format ulang.
  const pendingDigits = useRef<number | null>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const count = pendingDigits.current;
    pendingDigits.current = null;
    if (!input || count === null || document.activeElement !== input) return;
    const pos = caretAfterDigits(input.value, count);
    input.setSelectionRange(pos, pos);
  });

  function commit(digits: string, caretDigits: number) {
    const n = Number(digits);
    if (!Number.isSafeInteger(n)) return;
    pendingDigits.current = caretDigits;
    onChange(n);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (raw === '') {
      onChange(null);
      return;
    }
    // Ketikan di luar angka dan titik ditolak diam: input terkontrol kembali ke nilai lama.
    if (!/^[\d.]+$/.test(raw)) return;
    const caret = e.target.selectionStart ?? raw.length;
    commit(digitsOf(raw), digitsOf(raw.slice(0, caret)).length);
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    if (parseRupiah(pasted) === null) return;
    const input = e.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const left = digitsOf(input.value.slice(0, start));
    const right = digitsOf(input.value.slice(end));
    const inserted = digitsOf(pasted);
    commit(left + inserted + right, left.length + inserted.length);
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={labelHidden ? 'sr-only' : 'text-sm text-text-muted'}>
        {label}
      </label>
      <div className="flex min-h-11 items-center gap-2 rounded-field border border-border bg-surface px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
        <span aria-hidden="true" className="text-lg text-text-muted">
          Rp
        </span>
        <input
          id={id}
          ref={inputRef}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          disabled={disabled}
          value={display(value)}
          onChange={handleChange}
          onPaste={handlePaste}
          className={`num min-h-11 w-full min-w-0 bg-transparent text-text outline-none ${
            size === 'hero' ? 'text-hero font-bold' : 'text-lg'
          } disabled:cursor-not-allowed disabled:text-text-muted`}
        />
      </div>
    </div>
  );
}
