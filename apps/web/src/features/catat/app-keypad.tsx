'use client';

import type { Rupiah } from '@dompetku/domain';
import type { MouseEvent } from 'react';
import { focusRing } from '@/components/ui/styles';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0'] as const;

/** Tambah angka di kanan; nol di depan diabaikan, nilai di luar safe integer ditolak. */
function appendDigits(value: Rupiah | null, digits: string): Rupiah | null {
  const next = Number(String(value ?? '') + digits);
  if (!Number.isSafeInteger(next)) return value;
  return next === 0 ? null : next;
}

function dropDigit(value: Rupiah | null): Rupiah | null {
  if (value === null) return null;
  const next = Math.floor(value / 10);
  return next === 0 ? null : next;
}

// Fokus tetap di field nominal saat keypad ditekan dengan pointer.
const keepFocus = (e: MouseEvent) => {
  e.preventDefault();
};

// Tombol keypad di lapisan surface (lebih gelap dari sheet) agar terbaca sebagai tuts.
const key = `min-h-12 rounded-field bg-surface text-xl font-semibold text-text num hover:bg-bg active:bg-hairline ${focusRing}`;

/** Varian B: keypad dalam aplikasi. Keyboard fisik tetap jalan lewat field nominal. */
export function AppKeypad({
  value,
  onChange,
}: {
  value: Rupiah | null;
  onChange: (value: Rupiah | null) => void;
}) {
  return (
    <div role="group" aria-label="Keypad nominal" className="mt-3 grid grid-cols-3 gap-2">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onMouseDown={keepFocus}
          onClick={() => {
            onChange(appendDigits(value, k));
          }}
          className={key}
        >
          {k}
        </button>
      ))}
      <button
        type="button"
        aria-label="Hapus satu angka"
        onMouseDown={keepFocus}
        onClick={() => {
          onChange(dropDigit(value));
        }}
        className={key}
      >
        ⌫
      </button>
    </div>
  );
}
