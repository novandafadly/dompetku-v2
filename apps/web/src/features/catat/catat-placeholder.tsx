'use client';

import type { Rupiah } from '@dompetku/domain';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { CaretDownIcon } from '@/components/ui/icons/caret-down';
import { MoneyInput } from '@/components/ui/money-input';
import { SpaceIcon } from '@/components/ui/space-tag';
// Dari styles, bukan sheet: placeholder harus tetap bebas Radix di muat awal.
import { SHEET_HANDLE, SHEET_PANEL } from '@/components/ui/styles';

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
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-30 bg-scrim" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy="true"
        data-ruang={tint}
        data-state="open"
        className={SHEET_PANEL}
      >
        <span aria-hidden="true" className={SHEET_HANDLE} />
        <header className="flex items-center gap-2 px-4 pt-2 tablet:px-6 tablet:pt-6">
          {/* Bentuk sama dengan tombol judul sheet sebenarnya; belum bisa ditekan selama memuat. */}
          <h2 className="flex h-11 items-center gap-2 rounded-lg border-1.5 border-ruang bg-ruang-tint px-3 text-body/none font-extrabold text-ruang">
            <SpaceIcon space={tint} size={16} />
            {title}
            <CaretDownIcon size={14} weight="bold" />
          </h2>
        </header>
        <div className="px-4 pt-3 pb-6 tablet:px-6">
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
