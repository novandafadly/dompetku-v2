'use client';

import type { RefObject } from 'react';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { MagnifyingGlassIcon } from '@/components/ui/icons/magnifying-glass';
import type { CategoryVM } from '@/features/ledger/types';

/**
 * Chip saran berurutan tetap selama sheet terbuka; tidak ada yang terpilih otomatis.
 * HP: dua baris yang bisa digeser ke samping, tanpa ikon. Mulai 600 px (dialog): dibungkus, dengan ikon.
 * Kategori dari "Kategori lain…" tampil sebagai chip terpilih tambahan.
 */
export function CategoryChips({
  chips,
  all,
  value,
  onChange,
  onMore,
  moreRef,
}: {
  chips: CategoryVM[];
  all: CategoryVM[];
  value: string | undefined;
  onChange: (categoryId: string) => void;
  onMore: () => void;
  moreRef: RefObject<HTMLButtonElement | null>;
}) {
  const extra =
    value !== undefined && !chips.some((c) => c.id === value)
      ? all.find((c) => c.id === value)
      : undefined;
  const shown = extra ? [...chips, extra] : chips;

  return (
    <ChipGroup
      label="Kategori"
      className="chip-rows -mx-4 gap-2 px-4 py-0.5 tablet:mx-0 tablet:flex tablet:flex-wrap tablet:overflow-visible tablet:px-0"
    >
      {shown.map((c, i) => (
        <Chip
          key={c.id}
          variant="category"
          selected={c.id === value}
          focusable={value === undefined && i === 0}
          icon={
            <span className="hidden text-text-soft tablet:inline-flex">
              <CategoryIcon name={c.name} size={18} />
            </span>
          }
          onSelect={() => {
            onChange(c.id);
          }}
        >
          {c.name}
        </Chip>
      ))}
      <button
        ref={moreRef}
        type="button"
        onClick={onMore}
        className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3.5 text-label font-semibold whitespace-nowrap text-text hover-pointer:bg-hover focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus active:bg-surface-2"
      >
        <MagnifyingGlassIcon size={16} className="shrink-0 text-text-soft" />
        Kategori lain…
      </button>
    </ChipGroup>
  );
}
