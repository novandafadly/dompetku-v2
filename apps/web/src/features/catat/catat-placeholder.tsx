'use client';

import type { Rupiah } from '@dompetku/domain';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { MoneyInput } from '@/components/ui/money-input';
// Dari styles, bukan sheet: placeholder harus tetap bebas Radix di muat awal.
import { SHEET_HEADER, SHEET_PANEL, tints } from '@/components/ui/styles';

/**
 * Sheet Catat ringan yang tampil seketika selama kode sheet sebenarnya masih dimuat.
 * Field Nominal-nya nyata dan langsung fokus, jadi angka yang diketik setelah `c` atau klik
 * tidak hilang; nilainya diteruskan ke sheet sebenarnya saat termuat.
 */
export function CatatPlaceholder({
  title,
  tint,
  amount,
  onAmountChange,
  onClose,
}: {
  title: string;
  tint: 'pribadi' | 'bersama';
  amount: Rupiah | null;
  onAmountChange: (amount: Rupiah | null) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-20 bg-scrim" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy="true"
        data-ruang={tint}
        data-state="open"
        className={SHEET_PANEL}
      >
        <header className={`${SHEET_HEADER} pr-4 ${tints[tint]}`}>
          <h2 className="text-lg/tight font-semibold">{title}</h2>
        </header>
        <div className="px-4 py-3">
          <MoneyInput
            label="Nominal"
            labelHidden
            size="hero"
            inputRef={inputRef}
            value={amount}
            onChange={onAmountChange}
          />
        </div>
      </div>
    </>
  );
}
