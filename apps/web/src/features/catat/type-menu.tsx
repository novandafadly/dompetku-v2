'use client';

import type { Ruang } from '@dompetku/demo-data';
import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { CaretDownIcon } from '@/components/ui/icons/caret-down';
import { CheckIcon } from '@/components/ui/icons/check';
import { SpaceIcon } from '@/components/ui/space-tag';
import { focusRing } from '@/components/ui/styles';
import type { CatatType } from './source';

export const TYPE_TITLE: Record<CatatType, string> = {
  expense: 'Pengeluaran',
  income: 'Pemasukan',
  transfer: 'Transfer',
};

const TYPES: CatatType[] = ['expense', 'income', 'transfer'];

/**
 * Judul sheet Catat yang sekaligus pemilih jenis: "Pengeluaran · Pribadi ▾" berwarna ruang tujuan.
 * Teks tombol = nama dialog, jadi ruang tujuan selalu terbaca (juga oleh pembaca layar).
 */
export function TypeMenuButton({
  ref,
  space,
  title,
  open,
  describedBy,
  onToggle,
  busy = false,
  toSpace,
}: {
  ref: RefObject<HTMLButtonElement | null>;
  space: Ruang;
  /** Teks judul (`Jenis · Ruang`); bila `toSpace` ada, ` → {Ruang tujuan}` ditulis sesudahnya. */
  title: string;
  /** Transfer antar ruang: ruang tujuan, ditulis dan diberi warna ruangnya (S7-C1). */
  toSpace?: { space: Ruang; label: string; head: string; from: string } | undefined;
  open: boolean;
  describedBy: string;
  onToggle: () => void;
  /** Selama menyimpan: `aria-disabled`, menu tidak dibuka, fokus tetap. */
  busy?: boolean;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-describedby={describedBy}
      aria-disabled={busy || undefined}
      onClick={busy ? undefined : onToggle}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' && !open && !busy) {
          e.preventDefault();
          onToggle();
        }
      }}
      className={`flex h-11 min-w-0 items-center gap-2 max-tablet:gap-1.5 rounded-lg border-1.5 border-ruang bg-ruang-tint px-3 text-body/none font-extrabold text-ruang aria-disabled:border-hairline aria-disabled:bg-surface-2 aria-disabled:text-text-muted ${focusRing}`}
    >
      <SpaceIcon space={space} size={16} />
      {toSpace === undefined ? (
        <span className="truncate">{title}</span>
      ) : (
        <>
          {/* HP: jenis hanya untuk pembaca layar; kedua ruang tertulis utuh (tidak boleh terpotong). */}
          <span className="max-tablet:sr-only">{toSpace.head}</span>
          <span className="shrink-0">{toSpace.from}</span>
          <span className="shrink-0">→</span>
          <span data-ruang={toSpace.space} className="flex shrink-0 items-center gap-1 text-ruang">
            <SpaceIcon space={toSpace.space} size={16} />
            {toSpace.label}
          </span>
        </>
      )}
      <CaretDownIcon size={14} weight="bold" className="shrink-0" />
    </button>
  );
}

/** Menu jenis transaksi: panah atas/bawah, Enter/Spasi memilih, Escape menutup ke tombol judul. */
export function TypeMenu({
  value,
  onChange,
  onClose,
  ignore,
}: {
  value: CatatType;
  onChange: (type: CatatType) => void;
  onClose: () => void;
  /** Tombol pembuka: klik di sana tidak dihitung sebagai klik di luar menu. */
  ignore: RefObject<HTMLElement | null>;
}) {
  const menuRef = useRef<HTMLUListElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Saat terbuka: fokus ke jenis yang terpilih; klik di luar menu menutupnya.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onPointer = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (menuRef.current?.contains(t) || ignore.current?.contains(t)) return;
      closeRef.current();
    };
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [ignore]);

  function onKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []),
    ];
    const i = items.findIndex((el) => el === document.activeElement);
    const move = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(items.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') onClose();
  }

  return (
    <ul
      ref={menuRef}
      role="menu"
      aria-label="Jenis transaksi"
      data-own-escape=""
      onKeyDown={onKeyDown}
      className="absolute top-14 left-4 z-10 flex min-w-56 flex-col rounded-lg border border-border bg-surface p-1 shadow-float tablet:left-6 tablet:top-18"
    >
      {TYPES.map((t) => {
        const checked = t === value;
        return (
          <li key={t} role="none">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={checked}
              tabIndex={-1}
              onClick={() => {
                onChange(t);
                onClose();
              }}
              className={`flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-body text-text hover-pointer:bg-hover focus-visible:bg-hover ${checked ? 'font-bold' : 'font-medium'} ${focusRing}`}
            >
              <span className="flex w-4 shrink-0 justify-center">
                {checked ? <CheckIcon size={16} weight="bold" /> : null}
              </span>
              {TYPE_TITLE[t]}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
