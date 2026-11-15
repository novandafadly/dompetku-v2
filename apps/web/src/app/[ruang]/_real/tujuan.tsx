import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClass } from '@/components/ui/button';
import { CaretDownIcon } from '@/components/ui/icons/caret-down';
import { FlagBannerIcon } from '@/components/ui/icons/flag-banner';
import { InfoIcon } from '@/components/ui/icons/info';
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/ui/state';
import { card, focusRing } from '@/components/ui/styles';
import type { AccountVM, Ruang } from '@/features/ledger/types';
import { buildAccountHref, buildAddWalletHref } from '@/features/shell/hrefs';
import { PageHeader } from '@/features/shell/page-header';
import { TUJUAN_COPY as C } from '@/features/tujuan/copy';
import { ClosedGoalRow, GoalCardView, type GoalCardSlots } from '@/features/tujuan/goal-card-view';
import type { GoalData, GoalVM } from '@/features/tujuan/types';
import { Segmen } from './rencana';
import { RetryIsland } from './transaksi-islands';
import { TUJUAN_TITLE_ID } from './tujuan-ids';

/**
 * Segmen Tujuan di Rencana, mode nyata (Server Component; S13-TJ1, TJ2). Daftar dan kartu dirender
 * di server dari `api.list_goals`; tombol dan sheet adalah pulau klien yang dipasang pemanggil lewat
 * `slots` (chunk `tujuan-client`, terpisah dari `rencana-client`). Kedua ruang. Bilah satu warna
 * ruang, tanpa merah untuk progres rendah, tanpa perayaan.
 */

export interface TujuanSlots extends GoalCardSlots {
  /** `Tambah tujuan` (variant dan posisi ditentukan pemanggil). */
  add: (opts: {
    variant: 'primary' | 'secondary';
    plus?: boolean;
    className?: string;
  }) => ReactNode;
  restore: (goal: GoalVM) => ReactNode;
}

/** Dompet tabungan aktif, dan yang di antaranya belum punya tujuan aktif (pemilih sheet Tambah). */
export function savingsOf(accounts: readonly AccountVM[], goals: readonly GoalVM[]) {
  const savings = accounts.filter((a) => a.pocket === 'tabungan' && !a.archived);
  const taken = new Set(goals.filter((g) => g.status === 'active').map((g) => g.accountId));
  return { savings, free: savings.filter((a) => !taken.has(a.id)) };
}

function AddWalletLink({
  ruang,
  query,
  primary,
}: {
  ruang: Ruang;
  query: string;
  primary: boolean;
}) {
  return (
    <Link
      href={buildAddWalletHref(ruang, query)}
      className={
        primary
          ? buttonClass('primary', 'md')
          : `inline-flex min-h-11 items-center self-start rounded-md px-1 text-label font-bold text-accent-text hover-pointer:underline ${focusRing}`
      }
    >
      {C.addWallet}
    </Link>
  );
}

function ClosedGroup({ goals, slots }: { goals: GoalVM[]; slots: TujuanSlots }) {
  if (goals.length === 0) return null;
  return (
    <details className={`group ${card} px-4`}>
      <summary
        className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg text-label font-bold text-text-soft ${focusRing}`}
      >
        {C.closedGroup(goals.length)}
        <CaretDownIcon size={16} weight="bold" className="shrink-0 group-open:rotate-180" />
      </summary>
      <ul className="pb-1">
        {goals.map((g) => (
          <ClosedGoalRow key={g.goalId} goal={g} restore={slots.restore} />
        ))}
      </ul>
    </details>
  );
}

/** Isi segmen Tujuan: kosong (dua jenis), kartu aktif, lalu `Selesai dan diarsipkan`. */
export function TujuanList({
  ruang,
  query,
  data,
  accounts,
  slots,
}: {
  ruang: Ruang;
  query: string;
  data: GoalData;
  accounts: readonly AccountVM[];
  slots: TujuanSlots;
}) {
  const { savings, free } = savingsOf(accounts, data.goals);
  const active = data.goals.filter((g) => g.status === 'active');
  const closed = data.goals.filter((g) => g.status !== 'active');
  if (data.goals.length === 0) {
    return savings.length === 0 ? (
      <EmptyState
        tone="accent"
        icon={<FlagBannerIcon size={26} />}
        title={C.emptyNoWalletTitle}
        headingLevel={2}
        description={C.emptyNoWalletDescription}
        action={<AddWalletLink ruang={ruang} query={query} primary />}
      />
    ) : (
      <EmptyState
        tone="accent"
        icon={<FlagBannerIcon size={26} />}
        title={C.emptyNoGoalTitle}
        headingLevel={2}
        description={C.emptyNoGoalDescription}
        action={slots.add({ variant: 'primary' })}
      />
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={TUJUAN_TITLE_ID} className="text-header font-extrabold text-text">
          {C.heading}
        </h2>
        {free.length > 0
          ? slots.add({ variant: 'secondary', plus: true, className: 'w-full laptop:w-auto' })
          : null}
      </div>
      {free.length === 0 ? (
        <div className="flex flex-col items-start gap-0.5">
          {savings.length > 0 ? (
            <p className="flex items-start gap-1.5 text-meta font-medium text-text-soft">
              <InfoIcon size={16} className="mt-px shrink-0" />
              <span className="text-pretty">{C.allHaveGoals}</span>
            </p>
          ) : null}
          <AddWalletLink ruang={ruang} query={query} primary={false} />
        </div>
      ) : null}
      {active.length > 0 ? (
        <ul className="flex flex-col gap-3 laptop:gap-4">
          {active.map((g) => (
            <li key={g.goalId}>
              <GoalCardView
                goal={g}
                ruang={ruang}
                slots={slots}
                walletHref={buildAccountHref(ruang, g.accountId, query)}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <ClosedGroup goals={closed} slots={slots} />
    </>
  );
}

/** Halaman segmen Tujuan: header, segmen, isi. */
export function TujuanPageView(props: {
  ruang: Ruang;
  query: string;
  data: GoalData;
  accounts: readonly AccountVM[];
  slots: TujuanSlots;
}) {
  return (
    <>
      <PageHeader title="Rencana" />
      <div className="flex flex-col gap-3 laptop:max-w-180">
        <Segmen ruang={props.ruang} bagian="tujuan" query={props.query} />
        <TujuanList {...props} />
      </div>
    </>
  );
}

/** Galat muat segmen: Segmen tetap tampil, Anggaran dan Tagihan tidak ikut rusak. */
export function TujuanFailed({ ruang, query }: { ruang: Ruang; query: string }) {
  return (
    <>
      <PageHeader title="Rencana" />
      <div className="flex flex-col gap-3 laptop:max-w-180">
        <Segmen ruang={ruang} bagian="tujuan" query={query} />
        <ErrorState
          title={C.failedTitle}
          description={C.failedDescription}
          actions={<RetryIsland />}
        />
      </div>
    </>
  );
}

/** Kerangka segmen Tujuan selama server memuat (Suspense di halaman). */
export function TujuanLoading({ ruang, query }: { ruang: Ruang; query: string }) {
  return (
    <>
      <PageHeader title="Rencana" />
      <div className="flex flex-col gap-3 laptop:max-w-180">
        <Segmen ruang={ruang} bagian="tujuan" query={query} />
        <LoadingRegion label={C.loading}>
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </LoadingRegion>
      </div>
    </>
  );
}
