'use client';

import { monthSummary } from '@dompetku/demo-data';
import { formatRupiah } from '@dompetku/domain';
import { LedgerColumn } from '@/components/ui/ledger-column';
import type { TransaksiContext } from './context';

export function SummaryView({
  state,
  ruang,
  month,
}: Pick<TransaksiContext, 'state' | 'ruang'> & { month: string }) {
  const s = monthSummary(state, ruang, month);
  return (
    <section aria-label="Ringkasan bulan" className="mt-6 rounded-card bg-surface p-4">
      <LedgerColumn
        rows={[
          { label: 'Pemasukan', value: s.pemasukan },
          { label: 'Pengeluaran', value: s.pengeluaran, op: 'minus' },
        ]}
        total={s.selisih}
        totalLabel="Selisih"
      />
      <p className="mt-4 text-base text-text-muted">
        {`Tidak termasuk: Kas kantor ${formatRupiah(s.kantor)}, Transfer internal ${formatRupiah(s.transfer)}`}
      </p>
    </section>
  );
}
