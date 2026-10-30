'use client';

import { CheckCircleIcon, WarningIcon } from '@phosphor-icons/react';
import { safeToSpend } from '@dompetku/demo-data';
import { formatRupiah, shortDateLabel } from '@dompetku/domain';
import { Button } from '@/components/ui/button';
import { LedgerColumn } from '@/components/ui/ledger-column';
import { MoneyText } from '@/components/ui/money-text';
import type { BerandaContext } from './context';

export function SafeToSpend({ state, store, ruang, today }: BerandaContext) {
  const r = safeToSpend(state, ruang, today);
  const until = shortDateLabel(r.until);
  const title = `Aman dipakai${ruang === 'bersama' ? ' bersama' : ''} sampai ${until}`;

  const spentToday = state.entries.some(
    (e) =>
      e.ruang === ruang &&
      e.kind === 'expense' &&
      e.occurredOn === today &&
      e.voidedAt === undefined,
  );
  const marked = state.noSpendDays.some((d) => d.ruang === ruang && d.date === today);

  return (
    <section aria-labelledby="aman-dipakai">
      <h1 id="aman-dipakai" className="text-lg font-semibold text-accent">
        {title}
      </h1>
      <p data-testid="hero-amount" className="mt-1">
        <MoneyText value={r.total} size="hero" />
      </p>
      {r.total < 0 ? (
        <p className="mt-2 flex items-start gap-2 text-base text-danger">
          <WarningIcon size={20} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>Pengeluaran wajib bulan ini melebihi saldo operasional.</span>
        </p>
      ) : (
        <p className="mt-2 text-base text-text-muted">
          {`≈ ${formatRupiah(r.perDay)} per hari untuk ${String(r.daysLeft)} hari`}
        </p>
      )}
      <div className="mt-6">
        <LedgerColumn
          rows={[
            { label: 'Saldo operasional', value: r.operasional },
            { label: `Tagihan s.d. ${until}`, value: r.billsUntilEom, op: 'minus' },
            { label: 'Sisa anggaran wajib', value: r.budgetWajibRemaining, op: 'minus' },
          ]}
          total={r.total}
          totalLabel="Aman dipakai"
        />
      </div>
      <div className="mt-6">
        {marked ? (
          <p className="flex min-h-11 items-center gap-2 text-base text-text-muted">
            <CheckCircleIcon size={20} aria-hidden="true" className="shrink-0" />
            <span>Hari ini tercatat tanpa pengeluaran</span>
          </p>
        ) : !spentToday ? (
          <Button
            variant="secondary"
            onClick={() => {
              store.markNoSpendDay(ruang, today);
            }}
          >
            Tidak ada pengeluaran hari ini
          </Button>
        ) : null}
      </div>
    </section>
  );
}
