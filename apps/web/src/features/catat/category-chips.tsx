'use client';

import type { Category } from '@dompetku/demo-data';
import { useEffect, useRef, useState } from 'react';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { Combobox } from '@/components/ui/combobox';
import { focusRing } from '@/components/ui/styles';

/**
 * Chip saran berurutan tetap selama sheet terbuka; tidak ada yang terpilih otomatis.
 * Kategori dari "Kategori lain…" tampil sebagai chip terpilih tambahan.
 */
export function CategoryChips({
  chips,
  all,
  value,
  onChange,
}: {
  chips: Category[];
  all: Category[];
  value: string | undefined;
  onChange: (categoryId: string) => void;
}) {
  const [searching, setSearching] = useState(false);
  const refocus = useRef(false);
  const groupRef = useRef<HTMLDivElement>(null);
  // Setelah memilih dari pencarian, fokus pindah ke chip terpilih (combobox sudah hilang).
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    groupRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  });
  const extra =
    value !== undefined && !chips.some((c) => c.id === value)
      ? all.find((c) => c.id === value)
      : undefined;
  const shown = extra ? [...chips, extra] : chips;

  return (
    <div ref={groupRef} className="flex flex-col gap-2">
      <ChipGroup label="Kategori">
        {shown.map((c, i) => (
          <Chip
            key={c.id}
            selected={c.id === value}
            focusable={value === undefined && i === 0}
            onSelect={() => {
              onChange(c.id);
            }}
          >
            {c.name}
          </Chip>
        ))}
      </ChipGroup>
      {searching ? (
        <Combobox
          label="Cari kategori"
          placeholder="Ketik nama kategori"
          emptyText="Tidak ada kategori dengan nama itu."
          items={all.map((c) => ({ value: c.id, label: c.name }))}
          onSelect={(id) => {
            onChange(id);
            setSearching(false);
            refocus.current = true;
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setSearching(true);
          }}
          className={`inline-flex min-h-11 items-center self-start rounded-pill border border-dashed border-border px-4 text-base text-text hover:bg-surface-2 ${focusRing}`}
        >
          Kategori lain…
        </button>
      )}
    </div>
  );
}
