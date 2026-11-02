import { addMonths, monthName, monthYearLabel, type IsoDate } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import { IconButton } from '@/components/ui/icon-button';
import { CaretLeftIcon } from '@/components/ui/icons/caret-left';
import { CaretRightIcon } from '@/components/ui/icons/caret-right';
import { ListBulletsIcon } from '@/components/ui/icons/list-bullets';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { focusRing } from '@/components/ui/styles';
import { groupByDayVM } from '@/features/ledger/group-by-day';
import type { Ruang } from '@/features/ledger/types';
import { buildEntryHref, buildHref, buildSectionHref, RUANG_LABEL } from '@/features/shell/hrefs';
import { PageHeader } from '@/features/shell/page-header';
import { EntryListView, SampahLink } from '@/features/transaksi/entry-list-view';
import { SummaryViewVM } from '@/features/transaksi/summary-view-vm';
import { TransaksiLayout } from '@/features/transaksi/transaksi-layout';
import type { TransaksiData } from '@/server/ledger/transaksi';
import { CatatEmptyIsland, RetryIsland } from './transaksi-islands';

/** Tautan 44×44 berbentuk IconButton (navigasi bulan nyata = tautan server, bukan state klien). */
const iconLink = `inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text hover-pointer:bg-hover active:bg-surface-2 ${focusRing}`;

function MonthStep({
  label,
  href,
  icon,
}: {
  label: string;
  href: Route | null;
  icon: React.ReactNode;
}) {
  if (href === null) return <IconButton label={label} icon={icon} disabled />;
  return (
    <Link href={href} aria-label={label} className={iconLink} scroll={false}>
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
    </Link>
  );
}

/**
 * Transaksi mode nyata (Server Component): daftar per hari (`groupByDayVM` di server) dan
 * ringkasan bulan (`MonthSummaryVM`) dari data ruang ini saja. Filter kategori, Kantor,
 * reimburse, dan pencarian tidak dirender (loader belum mendukungnya); "Muat lagi" tidak ada
 * (satu bulan, maks. 1000 entri, dirender semua). Pulau klien = tombol Catat dan Coba lagi.
 */
export function TransaksiReal({
  ruang,
  today,
  month,
  minMonth,
  query,
  data,
}: {
  ruang: Ruang;
  today: IsoDate;
  /** Bulan terpilih 'YYYY-MM' (sudah divalidasi page). */
  month: string;
  /** Bulan paling awal yang bisa dituju (dompet pertama dibuka). */
  minMonth: string;
  /** Query yang dibawa tautan (mode nyata: hanya `theme`), '' atau '?a=b'. */
  query: string;
  data: TransaksiData;
}) {
  const current = today.slice(0, 7);
  const monthHref = (m: string) => buildHref(ruang, 'transaksi', query, { value: m, today });
  const nav = (
    <div role="group" aria-label="Bulan" className="flex items-center justify-between gap-2">
      <MonthStep
        label="Bulan sebelumnya"
        href={month > minMonth ? monthHref(addMonths(month, -1)) : null}
        icon={<CaretLeftIcon size={18} weight="bold" />}
      />
      <p
        aria-live="polite"
        className="text-body font-extrabold text-text laptop:min-w-40 laptop:text-center"
      >
        {monthYearLabel(month)}
      </p>
      <MonthStep
        label="Bulan berikutnya"
        href={month < current ? monthHref(addMonths(month, 1)) : null}
        icon={<CaretRightIcon size={18} weight="bold" />}
      />
    </div>
  );

  const groups = groupByDayVM(data.entries, today);
  const list =
    groups.length > 0 ? (
      <EntryListView
        groups={groups}
        idBase="hari"
        hrefFor={(id) => buildEntryHref(ruang, id, query, { value: month, today })}
      />
    ) : data.hasAny ? (
      <EmptyState
        icon={<ListBulletsIcon size={26} />}
        title={`Belum ada transaksi di ${monthName(month)}.`}
      />
    ) : (
      <EmptyState
        icon={<ListBulletsIcon size={26} />}
        title={`Belum ada transaksi di ${RUANG_LABEL[ruang]}.`}
        description="Catat transaksi pertama dengan tombol Catat."
        action={<CatatEmptyIsland />}
      />
    );

  return (
    <TransaksiLayout
      header={<PageHeader title="Transaksi" />}
      nav={nav}
      list={
        <div className="flex flex-col gap-3 tablet:gap-4">
          {nav}
          {list}
          <SampahLink href={buildSectionHref(ruang, 'sampah', query)} />
        </div>
      }
      summary={<SummaryViewVM month={month} summary={data.summary} />}
    />
  );
}

/** Gagal muat (galat loader ditangkap page): salinan tetap + Coba lagi (`router.refresh`). */
export function TransaksiFailed() {
  return (
    <>
      <PageHeader title="Transaksi" />
      <div className="laptop:max-w-250">
        <ErrorState
          title="Transaksi belum bisa dimuat."
          description="Periksa koneksi lalu coba lagi."
          actions={<RetryIsland />}
        />
      </div>
    </>
  );
}
