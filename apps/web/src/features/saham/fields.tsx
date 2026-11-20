'use client';

import { type RefObject, useId } from 'react';
import { FieldLabel, fieldShell } from '@/components/ui/field';
import { FieldError } from '@/components/ui/field-messages';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { LOT, SAHAM_COPY as C } from './copy';

/** Bagian formulir bersama sheet saham (Beli, Jual, Saham yang sudah dimiliki). */

export type Unit = 'lot' | 'lembar';

/** Lembar dari isian: angka bulat >= 1 (lot dikali 100); selain itu `null`. */
export function sharesOf(unit: Unit, text: string): number | null {
  if (!/^\d{1,13}$/.test(text)) return null;
  const n = Number(text);
  if (n < 1) return null;
  return unit === 'lot' ? n * LOT : n;
}

/** Teks pasti di bawah isian jumlah: `= 200 lembar` untuk lot, `= 2 lot` bila lembar habis dibagi 100. */
export function equalsText(unit: Unit, shares: number | null): string | null {
  if (shares === null) return null;
  if (unit === 'lot') return C.equalsShares(shares);
  return shares % LOT === 0 ? C.equalsLots(shares / LOT) : null;
}

/**
 * Jumlah saham: pilihan satuan (`Lot | Lembar`) lalu angka bulat. Teks pasti di bawahnya
 * (`aria-live`) supaya konversi tidak ditebak.
 */
export function SharesField({
  unit,
  onUnit,
  text,
  onText,
  error,
  readOnly,
  inputRef,
  extra,
}: {
  unit: Unit;
  onUnit: (u: Unit) => void;
  text: string;
  onText: (t: string) => void;
  error?: string | undefined;
  readOnly?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Di sisi kanan teks pasti (mis. `Jual semua`). */
  extra?: React.ReactNode;
}) {
  const id = useId();
  const labelId = `${id}-l`;
  const eqId = `${id}-eq`;
  const errId = `${id}-e`;
  const equals = equalsText(unit, sharesOf(unit, text));
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel id={labelId}>{C.amountField}</FieldLabel>
      <SegmentedControl
        labelledBy={labelId}
        value={unit}
        items={[
          { value: 'lot', label: C.unitLot },
          { value: 'lembar', label: C.unitShare },
        ]}
        onChange={(v) => {
          if (readOnly !== true) onUnit(v === 'lembar' ? 'lembar' : 'lot');
        }}
      />
      <div className={`${fieldShell(error !== undefined)} px-3.5`}>
        <input
          id={id}
          ref={inputRef}
          value={text}
          inputMode="numeric"
          autoComplete="off"
          aria-labelledby={labelId}
          aria-describedby={[equals === null ? null : eqId, error === undefined ? null : errId]
            .filter((x) => x !== null)
            .join(' ')}
          aria-invalid={error !== undefined || undefined}
          aria-disabled={readOnly === true || undefined}
          onChange={(e) => {
            if (readOnly !== true) onText(e.target.value.replace(/\D/g, '').slice(0, 13));
          }}
          className="min-h-11 w-full min-w-0 bg-transparent text-body font-medium text-text outline-none"
        />
      </div>
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-3">
        <p
          id={eqId}
          role="status"
          aria-live="polite"
          className="text-meta font-semibold text-text-soft"
        >
          {equals ?? ''}
        </p>
        {extra}
      </div>
      {error === undefined ? null : (
        <div role="alert">
          <FieldError id={errId}>{error}</FieldError>
        </div>
      )}
    </div>
  );
}
