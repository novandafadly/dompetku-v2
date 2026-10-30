'use client';

import type { Account } from '@dompetku/demo-data';
import { useId } from 'react';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { focusRing } from '@/components/ui/styles';

/** Dompet sumber (atau tujuan untuk pemasukan). Hanya dompet ruang tujuan yang ditawarkan. */
export function WalletSelect({
  direction,
  accounts,
  value,
  onChange,
}: {
  direction: 'Dari' | 'Ke';
  accounts: Account[];
  value: string;
  onChange: (accountId: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <label htmlFor={id} className="text-base text-text-muted">
        {direction}
        <span className="sr-only"> dompet</span>
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className={`min-h-11 w-full min-w-0 rounded-field border border-border bg-surface px-2 text-lg text-text ${focusRing}`}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Dompet tujuan transfer di ruang yang sama; dompet sumber tidak ditawarkan. */
export function DestinationChips({
  accounts,
  value,
  onChange,
}: {
  accounts: Account[];
  value: string | undefined;
  onChange: (accountId: string) => void;
}) {
  return (
    <ChipGroup label="Ke dompet">
      {accounts.map((a, i) => (
        <Chip
          key={a.id}
          selected={a.id === value}
          focusable={value === undefined && i === 0}
          onSelect={() => {
            onChange(a.id);
          }}
        >
          {a.name}
        </Chip>
      ))}
    </ChipGroup>
  );
}
