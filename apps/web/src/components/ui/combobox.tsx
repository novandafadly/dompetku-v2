'use client';

import { Command } from 'cmdk';
import { useEffect, useRef } from 'react';

export interface ComboboxItem {
  value: string;
  label: string;
}

/** Daftar yang bisa dicari (cmdk). Fokus langsung ke pencarian; panah memilih, Enter mengambil. */
export function Combobox({
  label,
  placeholder,
  items,
  emptyText,
  onSelect,
}: {
  label: string;
  placeholder: string;
  items: ComboboxItem[];
  emptyText: string;
  onSelect: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <Command label={label} loop className="flex flex-col gap-1">
      <span aria-hidden="true" className="text-sm text-text-muted">
        {label}
      </span>
      <Command.Input
        ref={inputRef}
        placeholder={placeholder}
        className="min-h-11 rounded-field border border-border bg-surface px-3 text-lg text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />
      <Command.List className="max-h-60 overflow-y-auto rounded-field border border-hairline">
        <Command.Empty className="px-3 py-3 text-base text-text-muted">{emptyText}</Command.Empty>
        {items.map((item) => (
          <Command.Item
            key={item.value}
            value={item.label}
            onSelect={() => {
              onSelect(item.value);
            }}
            className="flex min-h-11 cursor-pointer items-center px-3 text-base text-text data-[selected=true]:bg-surface-2"
          >
            {item.label}
          </Command.Item>
        ))}
      </Command.List>
    </Command>
  );
}
