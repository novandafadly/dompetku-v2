'use client';

import { Command } from 'cmdk';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { fieldShell } from './field';
import { MagnifyingGlassIcon } from './icons/magnifying-glass';

export interface ComboboxItem {
  value: string;
  label: string;
  icon?: ReactNode;
}

/**
 * Daftar yang bisa dicari (cmdk). Fokus langsung ke pencarian; panah memilih, Enter mengambil.
 * Escape hanya menutup pencarian (`data-own-escape` mencegah Sheet ikut tertutup).
 */
export function Combobox({
  label,
  placeholder,
  items,
  emptyText,
  onSelect,
  onCancel,
}: {
  label: string;
  placeholder: string;
  items: ComboboxItem[];
  emptyText: string;
  onSelect: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <Command
      label={label}
      loop
      data-own-escape=""
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }}
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <span id={labelId} aria-hidden="true" className="text-meta font-semibold text-text-soft">
          {label}
        </span>
        <div className={`${fieldShell(false)} px-3.5`}>
          <MagnifyingGlassIcon size={18} className="shrink-0 text-text-muted" />
          <Command.Input
            ref={inputRef}
            placeholder={placeholder}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-body font-medium text-text outline-none placeholder:text-text-muted"
          />
        </div>
      </div>
      <Command.List className="min-h-0 flex-1 overflow-y-auto">
        <Command.Empty className="py-3 text-label font-medium text-text-muted">
          {emptyText}
        </Command.Empty>
        {items.map((item) => (
          <Command.Item
            key={item.value}
            value={item.label}
            onSelect={() => {
              onSelect(item.value);
            }}
            className="flex min-h-13 cursor-pointer items-center gap-3 border-t border-hairline px-1 text-body font-semibold text-text first:border-t-0 data-[selected=true]:bg-hover"
          >
            {item.icon ? (
              <span aria-hidden="true" className="inline-flex text-text-soft">
                {item.icon}
              </span>
            ) : null}
            {item.label}
          </Command.Item>
        ))}
      </Command.List>
    </Command>
  );
}
