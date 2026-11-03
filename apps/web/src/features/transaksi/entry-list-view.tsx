import type { Route } from 'next';
import Link from 'next/link';
import { buttonClass } from '@/components/ui/button';
import { MoneyText } from '@/components/ui/money-text';
import { card } from '@/components/ui/styles';
import type { DayGroupVM } from '@/features/ledger/group-by-day';
import { EntryRowView } from './entry-row-view';

/**
 * Daftar Transaksi per hari dari VM, untuk kedua mode. Mode nyata: kelompok dihitung di server
 * (`groupByDayVM`) dan komponen ini dirender di server. Prototipe: pembungkus demo (`EntryList`)
 * mengelompokkan dengan `groupByDay` demo lalu memetakan entri ke VM.
 */
export function EntryListView({
  groups,
  idBase,
  hrefFor,
  reimburse,
}: {
  groups: DayGroupVM[];
  /** Awalan id heading kelompok (unik di halaman). */
  idBase: string;
  hrefFor: (id: string) => Route;
  /** Hanya data demo: entri pengeluaran yang menunggu reimburse. */
  reimburse?: (id: string) => boolean;
}) {
  return (
    <>
      <h2 className="sr-only">Daftar transaksi</h2>
      {groups.map((g) => (
        <section
          key={g.date}
          aria-labelledby={`${idBase}-${g.date}`}
          className="flex flex-col gap-2"
        >
          <h3
            id={`${idBase}-${g.date}`}
            className="flex items-baseline justify-between gap-3 px-1 text-meta font-bold text-text-soft"
          >
            <span>{g.label}</span>
            <MoneyText value={g.total} size="inherit" />
          </h3>
          <ul aria-label={`Transaksi ${g.label}`} className={`px-4 ${card}`}>
            {g.entries.map((e) => (
              <EntryRowView
                key={e.id}
                entry={e}
                href={hrefFor(e.id)}
                reimburse={reimburse?.(e.id) === true}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/** Tautan ke Sampah di bawah daftar (kedua mode). */
export function SampahLink({ href }: { href: Route }) {
  return (
    <Link href={href} prefetch={false} className={buttonClass('text', 'sm', 'self-start')}>
      Sampah
    </Link>
  );
}
