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
import { FieldLabel, fieldShell } from './field';

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
  optional = false,
  describedBy,
}: {
  value: Rupiah | null;
  onChange: (value: Rupiah | null) => void;
  label: string;
  disabled?: boolean;
  /** Label hanya untuk pembaca layar, bila awalan "Rp" dan konteks sudah menjelaskan field. */
  labelHidden?: boolean;
  /** 'none' untuk keypad dalam aplikasi: keyboard OS tidak muncul, keyboard fisik tetap jalan. */
  inputMode?: 'numeric' | 'none';
  /** 'hero': nominal besar Catat dengan garis bawah warna ruang; 'compact': mode keyboard HP (36 px). */
  size?: 'base' | 'hero' | 'compact';
  inputRef?: RefObject<HTMLInputElement | null>;
  optional?: boolean;
  describedBy?: string;
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

  const input = (
    <input
      id={id}
      ref={inputRef}
      type="text"
      inputMode={inputMode}
      autoComplete="off"
      disabled={disabled}
      value={display(value)}
      placeholder={size === 'base' ? '0' : undefined}
      onChange={handleChange}
      onPaste={handlePaste}
      aria-describedby={describedBy}
      className={`num min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:text-text-muted ${
        size === 'base'
          ? 'min-h-11 text-body font-medium'
          : size === 'hero'
            ? 'min-h-11 text-amount font-extrabold'
            : 'min-h-10 text-amount-sm font-extrabold'
      }`}
    />
  );

  if (size === 'base') {
    return (
      <div className="flex flex-col gap-1.5">
        {labelHidden ? (
          <label htmlFor={id} className="sr-only">
            {label}
          </label>
        ) : (
          <FieldLabel htmlFor={id} optional={optional}>
            {label}
          </FieldLabel>
        )}
        <div className={`${fieldShell(false)} px-3.5`}>
          <span aria-hidden="true" className="text-body font-bold text-text-muted">
            Rp
          </span>
          {input}
        </div>
      </div>
    );
  }

  // Nominal Catat: garis bawah 2 px warna ruang, abu (border) selama masih kosong.
  return (
    <div
      className={`flex items-baseline gap-2 border-b-2 px-0.5 pb-1 ${
        value !== null && value > 0 ? 'border-ruang' : 'border-border focus-within:border-focus'
      }`}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span aria-hidden="true" className="text-headline/none font-bold text-text-muted">
        Rp
      </span>
      {input}
    </div>
  );
}
