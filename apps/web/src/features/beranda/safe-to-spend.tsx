'use client';

import { safeToSpend } from '@dompetku/demo-data';
import { Button } from '@/components/ui/button';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { CheckIcon } from '@/components/ui/icons/check';
import { PlusIcon } from '@/components/ui/icons/plus';
import type { SafeToSpendVM } from '@/features/ledger/types';
import type { BerandaContext } from './context';
import { SafeToSpendCard, SafeToSpendEmptyView } from './safe-to-spend-view';

/** Pembungkus prototipe: VM dari selector demo + tombol hari tanpa pengeluaran di store demo. */
export function SafeToSpend({ state, store, ruang, today }: BerandaContext) {
  const r = safeToSpend(state, ruang, today);

  const spentToday = state.entries.some(
    (e) =>
      e.ruang === ruang &&
      e.kind === 'expense' &&
      e.occurredOn === today &&
      e.voidedAt === undefined,
  );
  const marked = state.noSpendDays.some((d) => d.ruang === ruang && d.date === today);
  const vm: SafeToSpendVM = {
    operasional: r.operasional,
    billsUntilEom: r.billsUntilEom,
    budgetWajibRemaining: r.budgetWajibRemaining,
    aman: r.total,
  };

  return (
    <>
      <SafeToSpendCard ruang={ruang} today={today} vm={vm} />
      {marked ? (
        <p className="flex min-h-11 items-center gap-2 text-label font-semibold text-text-soft">
          <CheckCircleIcon size={20} weight="fill" className="shrink-0 text-accent-text" />
          <span>Hari ini tercatat tanpa pengeluaran</span>
        </p>
      ) : !spentToday ? (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => {
            store.markNoSpendDay(ruang, today);
          }}
        >
          <CheckIcon size={18} weight="bold" />
          Tidak ada pengeluaran hari ini
        </Button>
      ) : null}
    </>
  );
}

/** B3 prototipe: tombol membuka sheet Tambah dompet demo. */
export function SafeToSpendEmpty({
  ruang,
  today,
  onAddWallet,
}: Pick<BerandaContext, 'ruang' | 'today'> & { onAddWallet: () => void }) {
  return (
    <SafeToSpendEmptyView
      ruang={ruang}
      today={today}
      action={
        <Button className="self-start" onClick={onAddWallet}>
          <PlusIcon size={18} weight="bold" />
          Tambah dompet
        </Button>
      }
    />
  );
}
