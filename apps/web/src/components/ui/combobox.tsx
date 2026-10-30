'use client';

import { Command } from 'cmdk';
import { useEffect, useRef } from 'react';
import { Button } from './button';

export interface ComboboxItem {
  value: string;
  label: string;
}

/**
 * Daftar yang bisa dicari (cmdk). Fokus langsung ke pencarian; panah memilih, Enter mengambil.
 * Escape dan "Batal" hanya menutup pencarian (`data-own-escape` mencegah Sheet ikut tertutup).
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
      className="flex flex-col gap-1"
    >
      <span aria-hidden="true" className="text-sm text-text-muted">
        {label}
      </span>
      <div className="flex gap-2">
        <Command.Input
          ref={inputRef}
          placeholder={placeholder}
          className="min-h-11 min-w-0 flex-1 rounded-field border border-border bg-surface px-3 text-lg text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
        />
        <Button variant="secondary" onClick={onCancel}>
          Batal
        </Button>
      </div>
      <Command.List className="max-h-60 overflow-y-auto rounded-field border border-hairline bg-surface">
        <Command.Empty className="px-3 py-3 text-base text-text-muted">{emptyText}</Command.Empty>
        {items.map((item) => (
          <Command.Item
            key={item.value}
            value={item.label}
            onSelect={() => {
              onSelect(item.value);
            }}
            className="flex min-h-11 cursor-pointer items-center px-3 text-base text-text data-[selected=true]:bg-surface-2 data-[selected=true]:font-semibold"
          >
            {item.label}
          </Command.Item>
        ))}
      </Command.List>
    </Command>
  );
}
