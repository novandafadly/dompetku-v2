'use client';

import type { Rupiah } from '@dompetku/domain';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { MoneyInput } from '@/components/ui/money-input';

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
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-20 bg-text/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy="true"
        data-ruang={tint}
        className="fixed inset-x-0 bottom-0 z-20 flex max-h-dvh flex-col overflow-hidden rounded-t-sheet bg-surface text-text animate-sheet-in dialog:inset-x-auto dialog:top-1/2 dialog:bottom-auto dialog:left-1/2 dialog:w-full dialog:max-w-lg dialog:-translate-x-1/2 dialog:-translate-y-1/2 dialog:rounded-sheet"
      >
        <header
          className={`flex min-h-13 items-center border-b border-hairline px-4 ${
            tint === 'pribadi' ? 'bg-pribadi-tint' : 'bg-bersama-tint'
          }`}
        >
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
