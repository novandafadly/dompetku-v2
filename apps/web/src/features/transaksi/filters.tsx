'use client';

import { entryCategoryName } from '@dompetku/demo-data';
import type { DemoState, Entry, Ruang } from '@dompetku/demo-data';
import { useId } from 'react';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { fieldShell } from '@/components/ui/field';
import { MagnifyingGlassIcon } from '@/components/ui/icons/magnifying-glass';

export type FilterId = 'semua' | 'operasional' | 'kantor' | 'reimburse';

export const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'semua', label: 'Semua' },
  { id: 'operasional', label: 'Operasional' },
  { id: 'kantor', label: 'Kantor' },
  { id: 'reimburse', label: 'Menunggu reimburse' },
];

/** Bersama tidak punya dompet kantor atau reimburse (ui-ux.md): chip disembunyikan, bukan dinonaktifkan. */
export function filtersFor(ruang: Ruang): typeof FILTERS {
  return ruang === 'pribadi'
    ? FILTERS
    : FILTERS.filter((f) => f.id === 'semua' || f.id === 'operasional');
}

export function filterLabel(id: FilterId): string {
  return FILTERS.find((f) => f.id === id)?.label ?? '';
}

export function accountName(state: DemoState, id: string): string {
  return state.accounts.find((a) => a.id === id)?.name ?? '';
}

export function matchesFilter(state: DemoState, e: Entry, filter: FilterId): boolean {
  switch (filter) {
    case 'semua':
      return true;
    case 'reimburse':
      return e.kind === 'expense' && e.reimbursable === true && e.voidedAt === undefined;
    default:
      return state.accounts.some((a) => a.id === e.accountId && a.pocket === filter);
  }
}

/** Huruf besar-kecil diabaikan; mencari di deskripsi, nama kategori dan nama dompet. */
export function matchesSearch(state: DemoState, e: Entry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return [
    e.description ?? '',
    entryCategoryName(state, e) ?? '',
    accountName(state, e.accountId),
  ].some((text) => text.toLowerCase().includes(needle));
}

export function SearchField({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const searchId = useId();
  return (
    <div className={`${fieldShell(false, 'sm')} px-3.5`}>
      <MagnifyingGlassIcon size={18} className="shrink-0 text-text-muted" />
      <label htmlFor={searchId} className="sr-only">
        Cari transaksi
      </label>
      <input
        id={searchId}
        type="search"
        placeholder="Cari keterangan"
        value={query}
        onChange={(e) => {
          onQuery(e.target.value);
        }}
        className="min-w-0 flex-1 bg-transparent text-body font-medium text-text outline-none placeholder:text-text-muted"
      />
    </div>
  );
}

/** Filter pil 44: HP digeser ke samping, laptop dibungkus. Aktif = warna dibalik + ✓. */
export function FilterChips({
  ruang,
  filter,
  onFilter,
}: {
  ruang: Ruang;
  filter: FilterId;
  onFilter: (id: FilterId) => void;
}) {
  return (
    <ChipGroup
      label="Filter"
      className="scrollbar-none -mx-3 flex gap-2 overflow-x-auto px-3 py-0.5 tablet:mx-0 tablet:flex-wrap tablet:overflow-visible tablet:px-0"
    >
      {filtersFor(ruang).map((f) => (
        <Chip
          key={f.id}
          selected={filter === f.id}
          onSelect={() => {
            onFilter(f.id);
          }}
        >
          {f.label}
        </Chip>
      ))}
    </ChipGroup>
  );
}
