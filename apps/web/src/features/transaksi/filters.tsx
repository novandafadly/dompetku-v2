'use client';

import type { DemoState, Entry, Ruang } from '@dompetku/demo-data';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { focusRing } from '@/components/ui/styles';

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

export function entryCategoryName(state: DemoState, e: Entry): string | undefined {
  return state.categories.find((c) => c.id === e.categoryId)?.name;
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

export function FilterBar({
  ruang,
  filter,
  onFilter,
  query,
  onQuery,
}: {
  ruang: Ruang;
  filter: FilterId;
  onFilter: (id: FilterId) => void;
  query: string;
  onQuery: (q: string) => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-3">
      <input
        type="search"
        aria-label="Cari transaksi"
        placeholder="Cari deskripsi, kategori, dompet"
        value={query}
        onChange={(e) => {
          onQuery(e.target.value);
        }}
        className={`min-h-11 w-full rounded-field border border-border bg-surface px-3 text-lg text-text placeholder:text-text-muted ${focusRing}`}
      />
      <ChipGroup label="Filter">
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
    </div>
  );
}
