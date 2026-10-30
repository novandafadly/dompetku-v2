'use client';

import { useId, type ClipboardEvent, type ChangeEvent } from 'react';
import { parseRupiah, type Rupiah } from '@dompetku/domain';

function display(value: Rupiah | null): string {
  return value === null ? '' : String(value).replace(/\B(?=(\d{3})+$)/g, '.');
}

export function MoneyInput({
  value,
  onChange,
  label,
  disabled,
}: {
  value: Rupiah | null;
  onChange: (value: Rupiah | null) => void;
  label: string;
  disabled?: boolean;
}) {
  const id = useId();

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (raw === '') {
      onChange(null);
      return;
    }
    // Ketikan di luar angka dan titik ditolak diam: input terkontrol kembali ke nilai lama.
    if (!/^[\d.]+$/.test(raw)) return;
    const n = Number(raw.replaceAll('.', ''));
    if (Number.isSafeInteger(n)) onChange(n);
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const parsed = parseRupiah(e.clipboardData.getData('text'));
    if (parsed !== null) onChange(parsed);
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-text-muted">
        {label}
      </label>
      <div className="flex min-h-11 items-center gap-2 rounded-field border border-border bg-surface px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
        <span aria-hidden="true" className="text-lg text-text-muted">
          Rp
        </span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          value={display(value)}
          onChange={handleChange}
          onPaste={handlePaste}
          className="num min-h-11 w-full min-w-0 bg-transparent text-lg text-text outline-none disabled:cursor-not-allowed disabled:text-text-muted"
        />
      </div>
    </div>
  );
}
