import type { Route } from 'next';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { ArchiveIcon } from '@/components/ui/icons/archive';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { ClockIcon } from '@/components/ui/icons/clock';
import { FlagBannerIcon } from '@/components/ui/icons/flag-banner';
import { InfoIcon } from '@/components/ui/icons/info';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { MoneyText } from '@/components/ui/money-text';
import { card, focusRing, rowDivider } from '@/components/ui/styles';
import type { Ruang } from '@/features/ledger/types';
import { TUJUAN_COPY as C } from './copy';
import { goalFailedText } from './galat';
import { goalState, isNegative, restoreState, savedBand } from './present';
import type { GoalVM } from './types';

/**
 * Kartu progres tujuan (bingkai S13-TJ3) dan baris tujuan tertutup (TJ2/TJ8). Server Component,
 * dipakai bersama oleh Rencana dan (Task 5) Detail dompet; tombol aksi adalah pulau klien yang
 * dipasang pemanggil lewat `slots`. Bilah satu warna ruang, tidak pernah merah/amber; angka dari
 * SQL (UI memilih kalimat, tidak menghitung).
 */

export interface GoalCardSlots {
  /** `Selesaikan tujuan` (hanya dipakai bila tercapai). */
  complete: (goal: GoalVM) => ReactNode;
  edit: (goal: GoalVM) => ReactNode;
  archive: (goal: GoalVM) => ReactNode;
}

const BAR_FILL: Record<Ruang, string> = { pribadi: 'bg-pribadi', bersama: 'bg-bersama' };
const SUB = 'flex items-start gap-1.5 text-meta font-medium text-text-soft';

function Bar({ goal, ruang, labelledBy }: { goal: GoalVM; ruang: Ruang; labelledBy: string }) {
  return (
    <div
      role="progressbar"
      aria-labelledby={labelledBy}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={goal.pct}
      aria-valuetext={C.progressText(goal.pct, goal.saved, goal.target)}
      className="h-2 w-full overflow-hidden rounded-xs border border-hairline bg-surface-2"
    >
      <span
        className={`block h-full ${BAR_FILL[ruang]}`}
        style={{ width: `${String(goal.pct)}%` }}
      />
    </div>
  );
}

function Status({ state }: { state: ReturnType<typeof goalState> }) {
  if (state === 'reached') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-meta/none font-bold text-accent-text">
        <CheckCircleIcon size={16} weight="fill" />
        {C.reached}
      </span>
    );
  }
  if (state === 'overdue') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-meta/none font-bold text-text-soft">
        <ClockIcon size={16} />
        {C.overdue}
      </span>
    );
  }
  return null;
}

function Numbers({ goal }: { goal: GoalVM }) {
  const band = savedBand(goal);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {band === 'none' ? (
          <span className="text-body font-semibold text-text-soft">{C.nothingSaved}</span>
        ) : (
          <>
            <MoneyText
              value={goal.saved}
              size="inherit"
              className="text-headline font-extrabold text-text"
            />
            <span className="text-meta font-semibold whitespace-nowrap text-text-soft">
              {C.ofTarget(goal.target)}
            </span>
          </>
        )}
      </div>
      <span className="num shrink-0 text-body font-bold text-text">
        {band === 'tiny' ? C.belowOne : C.pct(goal.pct)}
      </span>
    </div>
  );
}

/** Kalimat bawah bilah, dipilih dari nilai SQL menurut tabel keadaan TJ3. */
function SubLines({ goal }: { goal: GoalVM }) {
  const state = goalState(goal);
  const band = savedBand(goal);
  if (state === 'reached') return <p className={SUB}>{C.finishHint(goal.accountName)}</p>;
  return (
    <>
      {band === 'none' ? (
        <>
          <p className={`${SUB} font-semibold`}>{C.targetLine(goal.target)}</p>
          {isNegative(goal) ? (
            <p className={SUB}>
              <InfoIcon size={14} className="mt-0.5 shrink-0" />
              <span className="text-pretty">{C.walletNegative(goal.accountName)}</span>
            </p>
          ) : (
            <p className={SUB}>{C.fillVia(goal.accountName)}</p>
          )}
        </>
      ) : (
        <p className={SUB}>{C.remaining(goal.remaining)}</p>
      )}
      {state === 'overdue' && goal.targetOn !== null ? (
        <p className={SUB}>{C.overdueHint(goal.targetOn)}</p>
      ) : null}
      {goal.perPeriod !== null && goal.targetOn !== null ? (
        <>
          <p className={`${SUB} font-semibold text-text`}>
            {goal.periodsLeft === 1
              ? C.needOnce(goal.perPeriod, goal.targetOn)
              : C.needPerMonth(goal.perPeriod, goal.targetOn)}
          </p>
          <p className="text-caption font-medium text-text-muted">{C.needNote}</p>
        </>
      ) : null}
    </>
  );
}

export function GoalCardView({
  goal,
  ruang,
  slots,
  walletHref,
}: {
  goal: GoalVM;
  ruang: Ruang;
  slots: GoalCardSlots;
  /** `Lihat dompet` (Rencana); `null` di Detail dompet. */
  walletHref: Route | null;
}) {
  const nameId = useId();
  const state = goalState(goal);
  return (
    <section
      aria-labelledby={nameId}
      className={`flex flex-col gap-2.5 p-4 laptop:p-5 ${card}`}
      data-goal-id={goal.goalId}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <FlagBannerIcon size={18} className="mt-px shrink-0 text-text-soft" />
          <h3
            id={nameId}
            title={goal.name}
            className="line-clamp-2 text-body font-bold break-words text-text"
          >
            {goal.name}
          </h3>
        </div>
        <Status state={state} />
      </div>
      <p className="flex min-w-0 items-center gap-1 text-meta font-medium text-text-muted">
        <WalletIcon size={14} className="shrink-0" />
        <span className="truncate" title={goal.accountName}>
          {goal.accountName}
        </span>
        {goal.createdByName === null ? null : (
          <span className="shrink-0">{` · ${C.createdBy(goal.createdByName)}`}</span>
        )}
      </p>
      <Numbers goal={goal} />
      <Bar goal={goal} ruang={ruang} labelledBy={nameId} />
      <div className="flex flex-col gap-0.5">
        <SubLines goal={goal} />
      </div>
      <div className="-mx-1 flex flex-wrap items-center gap-x-1 gap-y-0.5">
        {state === 'reached' ? slots.complete(goal) : null}
        {slots.edit(goal)}
        {slots.archive(goal)}
        {walletHref === null ? null : (
          <Link
            href={walletHref}
            aria-label={`${C.viewWallet} ${goal.accountName}`}
            className={`inline-flex min-h-11 items-center rounded-lg px-3 text-label font-bold text-accent-text hover-pointer:bg-hover ${focusRing}`}
          >
            {C.viewWallet}
          </Link>
        )}
      </div>
    </section>
  );
}

/**
 * Baris `Selesai dan diarsipkan` (TJ2/TJ8): tanpa bilah dan persen (progres live dari saldo hari
 * ini menyesatkan untuk tujuan yang sudah ditutup). Kolom kanan = `Pulihkan` (slot) atau kalimat.
 */
export function ClosedGoalRow({
  goal,
  restore,
}: {
  goal: GoalVM;
  restore: (goal: GoalVM) => ReactNode;
}) {
  const done = goal.status === 'completed';
  const when =
    done && goal.completedOn !== null
      ? C.completedOn(goal.completedOn)
      : goal.archivedOn !== null
        ? C.archivedOn(goal.archivedOn)
        : '';
  const rs = restoreState(goal);
  return (
    <li className={rowDivider}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-soft"
        >
          {done ? <CheckCircleIcon size={20} /> : <ArchiveIcon size={20} />}
        </span>
        <div className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
          <span
            title={goal.name}
            className="line-clamp-2 text-body font-semibold break-words text-text"
          >
            {goal.name}
          </span>
          <span className="text-meta font-medium text-text-muted">
            {`${when} · ${goal.accountName} · ${C.targetShort(goal.target)}`}
          </span>
          {rs === 'archived-wallet' ? (
            <span className="flex items-center gap-1 text-meta font-medium text-text-muted">
              <InfoIcon size={14} className="shrink-0" />
              {C.walletArchived}
            </span>
          ) : null}
        </div>
        {rs === 'ok' ? restore(goal) : null}
        {rs === 'wallet-busy' ? (
          <p className="flex basis-full items-start gap-1.5 text-meta font-semibold text-text">
            <InfoIcon size={14} className="mt-0.5 shrink-0" />
            <span className="text-pretty">{goalFailedText('goal_exists', goal.accountName)}</span>
          </p>
        ) : null}
      </div>
    </li>
  );
}
