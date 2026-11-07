import { dayOfMonth, dueLabel, weekdayShort, type IsoDate } from '@dompetku/domain';
import { BillRow } from '@/components/ui/bill-row';
import Link from 'next/link';
import { CalendarDotsIcon } from '@/components/ui/icons/calendar-dots';
import { EmptyLine, ListCard } from '@/components/ui/list-card';
import { focusRing } from '@/components/ui/styles';
import { CardError } from '@/features/bersama/card-error';
import type { Ruang } from '@/features/ledger/types';
import { buildHref } from '@/features/shell/hrefs';
import { TAGIHAN_COPY } from '@/features/rencana/copy';
import type { BerandaBillsVM } from '@/server/ledger/beranda';
import { rencanaBagianHref } from './rencana-link';

/** Baris maksimum di Beranda; sisanya di `Semua` (S9-BR2). */
const MAX_ROWS = 5;

/**
 * Kartu `Tagihan 7 hari` mode nyata (S9-BR2). Server Component, tanpa `'use client'` dan tanpa
 * demo: `BillsSoon` prototipe tidak dipakai dan tidak diubah. Baris hanya baca (membayar dari
 * Rencana). Nama aksesibel baris = isi yang terlihat (nama, jatuh tempo, nominal).
 */
export function BillsDueCard({
  ruang,
  query,
  today,
  data,
}: {
  ruang: Ruang;
  query: string;
  today: IsoDate;
  data: BerandaBillsVM | 'error';
}) {
  const icon = <CalendarDotsIcon size={18} />;
  if (data === 'error') {
    return (
      <ListCard title="Tagihan 7 hari" icon={icon}>
        <CardError
          message="Tagihan belum bisa dimuat."
          retryHref={buildHref(ruang, 'beranda', query)}
        />
      </ListCard>
    );
  }
  const href = rencanaBagianHref(ruang, 'tagihan', query);
  if (data.items.length === 0) {
    return (
      <ListCard title="Tagihan 7 hari" icon={icon}>
        {data.hasBills ? (
          <EmptyLine>Tidak ada tagihan 7 hari ke depan.</EmptyLine>
        ) : (
          <>
            <EmptyLine>Belum ada tagihan.</EmptyLine>
            <Link
              href={href}
              className={`-mt-2 mb-1 inline-flex min-h-11 items-center self-start rounded-md px-2 text-meta font-bold text-accent-text hover-pointer:underline ${focusRing}`}
            >
              {TAGIHAN_COPY.add}
            </Link>
          </>
        )}
      </ListCard>
    );
  }
  return (
    <ListCard
      title="Tagihan 7 hari"
      icon={icon}
      link={{ href, label: 'Semua', srLabel: 'tagihan' }}
    >
      <ul>
        {data.items.slice(0, MAX_ROWS).map((b) => (
          <BillRow
            key={b.occurrenceId}
            weekday={weekdayShort(b.dueOn)}
            day={dayOfMonth(b.dueOn)}
            name={b.name}
            due={dueLabel(b.dueOn, today)}
            overdue={b.overdue}
            amount={b.amount}
          />
        ))}
      </ul>
    </ListCard>
  );
}
