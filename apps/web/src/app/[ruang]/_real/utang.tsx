import Link from 'next/link';
import type { ReactNode } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { CaretDownIcon } from '@/components/ui/icons/caret-down';
import { ClockIcon } from '@/components/ui/icons/clock';
import { HandCoinsIcon } from '@/components/ui/icons/hand-coins';
import { MinusCircleIcon } from '@/components/ui/icons/minus-circle';
import { EmptyLine, ListCard } from '@/components/ui/list-card';
import { MoneyText } from '@/components/ui/money-text';
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/ui/state';
import { card, focusRing, heroCard, rowDivider } from '@/components/ui/styles';
import type { Ruang } from '@/features/ledger/types';
import { buildDebtHref, buildDebtListHref, buildEntryHref } from '@/features/shell/hrefs';
import { PageHeader } from '@/features/shell/page-header';
import { dateWithYear, debtHeading, directionName, UTANG_COPY } from '@/features/utang/copy';
import {
  DebtBodyView,
  DeletedBodyView,
  InitialTile,
  PaidBar,
  SettledMark,
  SettledRowView,
  SisaCard,
} from '@/features/utang/debt-views';
import { groupDebts, paidCaptionDetail } from '@/features/utang/present';
import type {
  DebtDetailVM,
  DebtListItemVM,
  DebtPaymentVM,
  UtangData,
} from '@/features/utang/types';
import { Segmen } from './rencana';
import { UTANG_TITLE_ID } from './utang-ids';
import { RetryIsland } from './transaksi-islands';

/**
 * Tampilan Utang mode nyata (Server Component; S11-UT1, S11-DT1). Daftar dan detail dirender di
 * server dari data SQL; tombol dan sheet adalah pulau klien yang dipasang pemanggil lewat `slots`
 * (dimuat malas di chunk `utang-client`, terpisah dari `rencana-client`). Hanya Pribadi, hanya
 * mode nyata. Tanpa merah/hijau untuk angka utang; `Lunas` = ikon + teks, tidak pernah `Rp 0`.
 */

const ROW_BODY = `flex min-h-18 min-w-0 flex-1 items-start py-3 pr-2 pl-4 text-left hover-pointer:bg-hover active:bg-hover ${focusRing}`;
const HISTORY_BODY = `flex min-h-16 min-w-0 flex-[1_1_12rem] flex-col justify-center gap-0.5 py-2.5 pr-2 pl-4 text-left hover-pointer:bg-hover active:bg-hover ${focusRing}`;

export interface ListSlots {
  /** `Tambah utang`: pembuka sheet (`variant` + posisi ditentukan pemanggil). */
  add: (opts: {
    variant: 'primary' | 'secondary';
    plus?: boolean;
    className?: string;
  }) => ReactNode;
  pay: (debt: DebtListItemVM) => ReactNode;
  restore: (debt: DebtListItemVM) => ReactNode;
}

export interface DetailSlots {
  pay: ReactNode;
  edit: ReactNode;
  remove: ReactNode;
  cancel: (payment: DebtPaymentVM) => ReactNode;
}

function Details({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className={`group ${card} px-4`}>
      <summary
        className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg text-label font-bold text-text-soft ${focusRing}`}
      >
        {summary}
        <CaretDownIcon size={16} weight="bold" className="shrink-0 group-open:rotate-180" />
      </summary>
      <ul className="pb-1">{children}</ul>
    </details>
  );
}

function OpenRow({
  debt,
  ruang,
  query,
  slots,
}: {
  debt: DebtListItemVM;
  ruang: Ruang;
  query: string;
  slots: ListSlots;
}) {
  return (
    <li className={rowDivider}>
      <div className="-mx-4 flex items-start">
        <Link href={buildDebtHref(ruang, debt.debtId, query)} className={ROW_BODY}>
          <DebtBodyView debt={debt} />
        </Link>
        <span className="ml-auto flex shrink-0 flex-col items-end pt-2.5 pr-4">
          {slots.pay(debt)}
        </span>
      </div>
    </li>
  );
}

function DirectionGroup({
  title,
  debts,
  ruang,
  query,
  slots,
}: {
  title: string;
  debts: DebtListItemVM[];
  ruang: Ruang;
  query: string;
  slots: ListSlots;
}) {
  if (debts.length === 0) return null;
  return (
    <ListCard title={title} icon={<HandCoinsIcon size={18} />}>
      <ul>
        {debts.map((d) => (
          <OpenRow key={d.debtId} debt={d} ruang={ruang} query={query} slots={slots} />
        ))}
      </ul>
    </ListCard>
  );
}

/**
 * Isi segmen Utang (UT1): kartu `Sisa`, `Saya berutang`, `Piutang` (kelompok kosong tidak
 * dirender), `Lunas`, `Utang dihapus`, lalu `Tambah utang` (HP; di laptop ada di header).
 */
export function UtangList({
  ruang,
  query,
  data,
  slots,
}: {
  ruang: Ruang;
  query: string;
  data: UtangData;
  slots: ListSlots;
}) {
  const g = groupDebts(data.debts);
  if (data.debts.length === 0) {
    return (
      <EmptyState
        tone="accent"
        icon={<HandCoinsIcon size={28} />}
        title={UTANG_COPY.emptyTitle}
        headingLevel={2}
        description={UTANG_COPY.emptyDescription}
        action={slots.add({ variant: 'primary' })}
      />
    );
  }
  return (
    <>
      <SisaCard totals={data.totals} />
      <DirectionGroup
        title={UTANG_COPY.borrowed}
        debts={g.borrowed}
        ruang={ruang}
        query={query}
        slots={slots}
      />
      <DirectionGroup
        title={UTANG_COPY.lent}
        debts={g.lent}
        ruang={ruang}
        query={query}
        slots={slots}
      />
      {g.settled.length > 0 ? (
        <Details summary={UTANG_COPY.settledGroup(g.settled.length)}>
          {g.settled.map((d) => (
            <li key={d.debtId} className={rowDivider}>
              <Link
                href={buildDebtHref(ruang, d.debtId, query)}
                className={`-mx-4 block px-4 hover-pointer:bg-hover active:bg-hover ${focusRing}`}
              >
                <SettledRowView debt={d} />
              </Link>
            </li>
          ))}
        </Details>
      ) : null}
      {g.deleted.length > 0 ? (
        <Details summary={UTANG_COPY.deletedGroup(g.deleted.length)}>
          {g.deleted.map((d) => (
            <li key={d.debtId} className={rowDivider}>
              <div className="flex flex-wrap items-center gap-x-2">
                <DeletedBodyView debt={d} />
                {slots.restore(d)}
              </div>
            </li>
          ))}
        </Details>
      ) : null}
      {slots.add({ variant: 'secondary', plus: true, className: 'w-full laptop:hidden' })}
    </>
  );
}

/** Halaman segmen Utang: header, segmen, isi. `action` = tombol laptop di header. */
export function UtangPageView({
  ruang,
  query,
  data,
  slots,
}: {
  ruang: Ruang;
  query: string;
  data: UtangData;
  slots: ListSlots;
}) {
  return (
    <>
      <PageHeader
        title="Rencana"
        action={data.debts.length > 0 ? slots.add({ variant: 'secondary', plus: true }) : undefined}
      />
      <div className="flex flex-col gap-3 laptop:max-w-180">
        <Segmen ruang={ruang} bagian="utang" query={query} />
        <UtangList ruang={ruang} query={query} data={data} slots={slots} />
      </div>
    </>
  );
}

/** Galat muat segmen: Segmen tetap tampil, Anggaran dan Tagihan tidak ikut rusak. */
export function UtangFailed({ ruang, query }: { ruang: Ruang; query: string }) {
  return (
    <>
      <PageHeader title="Rencana" />
      <div className="flex flex-col gap-3 laptop:max-w-180">
        <Segmen ruang={ruang} bagian="utang" query={query} />
        <ErrorState
          title={UTANG_COPY.failedTitle}
          description={UTANG_COPY.failedDescription}
          actions={<RetryIsland />}
        />
      </div>
    </>
  );
}

/** Kerangka segmen Utang selama server memuat (Suspense di halaman). */
export function UtangLoading({ ruang, query }: { ruang: Ruang; query: string }) {
  return (
    <>
      <PageHeader title="Rencana" />
      <div className="flex flex-col gap-3 laptop:max-w-180">
        <Segmen ruang={ruang} bagian="utang" query={query} />
        <LoadingRegion label={UTANG_COPY.loading}>
          <Skeleton className="h-24" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </LoadingRegion>
      </div>
    </>
  );
}

// ===== Detail (DT1) =====

function PaymentRow({
  payment,
  detail,
  ruang,
  query,
  cancel,
}: {
  payment: DebtPaymentVM;
  detail: DebtDetailVM;
  ruang: Ruang;
  query: string;
  cancel: (p: DebtPaymentVM) => ReactNode;
}) {
  const lent = detail.direction === 'lent';
  const date = dateWithYear(payment.occurredOn);
  return (
    <li className={rowDivider}>
      <div className="-mx-4 flex flex-wrap items-start">
        <Link
          href={buildEntryHref(ruang, payment.entryId, query)}
          className={`${HISTORY_BODY} ${payment.voided ? 'text-text-muted' : ''}`}
        >
          <span
            className={`text-body font-semibold ${payment.voided ? 'text-text-muted' : 'text-text'}`}
          >
            {date}
          </span>
          <span className="text-meta font-medium text-text-muted">
            {lent ? `Diterima di ${payment.accountName}` : `Dibayar dari ${payment.accountName}`}
          </span>
        </Link>
        <span className="ml-auto flex shrink-0 flex-col items-end gap-1.5 pt-2.5 pr-4 pb-2">
          <span className={`whitespace-nowrap ${payment.voided ? 'text-text-muted' : 'text-text'}`}>
            <MoneyText value={payment.amount} />
          </span>
          {payment.voided ? (
            <span className="flex min-h-7 items-center gap-1 text-meta font-bold text-text-muted">
              <MinusCircleIcon size={14} weight="fill" className="shrink-0" />
              {UTANG_COPY.cancelled}
            </span>
          ) : (
            cancel(payment)
          )}
        </span>
      </div>
    </li>
  );
}

function RincianCard({ detail }: { detail: DebtDetailVM }) {
  const running = detail.mode === 'berjalan';
  const rows: { label: string; value: ReactNode; extra?: string }[] = [
    { label: UTANG_COPY.directionLabel, value: directionName(detail.direction) },
    { label: UTANG_COPY.contactLabel, value: detail.contactName },
    {
      label: UTANG_COPY.recordedAs,
      value: running ? UTANG_COPY.modeRunning : UTANG_COPY.modeNew,
      ...(running ? { extra: UTANG_COPY.modeRunningNote } : {}),
    },
    ...(!running && detail.accountName !== null
      ? [{ label: UTANG_COPY.walletLabel, value: detail.accountName }]
      : []),
    ...(detail.note !== null ? [{ label: UTANG_COPY.noteLabel, value: detail.note }] : []),
  ];
  return (
    <section aria-label={UTANG_COPY.details} className={`${card} flex flex-col px-4 pt-3.5 pb-1`}>
      <h2 className="text-label font-bold text-text-soft">{UTANG_COPY.details}</h2>
      <dl>
        {rows.map((r) => (
          <div key={r.label} className={`${rowDivider} flex flex-col gap-0.5 py-2.5`}>
            <dt className="text-meta font-semibold text-text-soft">{r.label}</dt>
            <dd className="text-body font-medium break-words text-text">{r.value}</dd>
            {r.extra === undefined ? null : (
              <dd className="text-meta font-medium text-text-muted">{r.extra}</dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Detail utang (DT1): kartu utama (sisa atau `Lunas`, bilah, caption), aksi, rincian, riwayat
 * pembayaran (yang dibatalkan tetap tampil, redup, bertanda `Dibatalkan`).
 */
export function UtangDetailView({
  ruang,
  query,
  detail,
  slots,
}: {
  ruang: Ruang;
  query: string;
  detail: DebtDetailVM;
  slots: DetailSlots;
}) {
  const heading = debtHeading(detail.direction, detail.contactName);
  const subParts = [
    ...(detail.title === null ? [] : [detail.title]),
    `sejak ${dateWithYear(detail.openedOn)}`,
  ];
  const sub = subParts.join(' · ');
  const payments = [...detail.payments].sort(
    (a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt),
  );
  return (
    <div className="flex flex-col gap-3 tablet:gap-4 laptop:max-w-180 laptop:pt-6">
      <BackLink href={buildDebtListHref(ruang, query)}>{UTANG_COPY.detailBack}</BackLink>
      <section aria-labelledby={UTANG_TITLE_ID} className={`${heroCard} flex flex-col gap-3 p-4`}>
        <div className="flex items-start gap-3">
          <InitialTile name={detail.contactName} size={12} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h1
              id={UTANG_TITLE_ID}
              tabIndex={-1}
              className="text-headline font-extrabold break-words text-text outline-none"
            >
              {heading}
            </h1>
            <p className="text-meta font-medium break-words text-text-muted">{sub}</p>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          {detail.settled ? (
            <SettledMark size="lg" />
          ) : (
            <>
              <span className="text-label font-medium text-text-soft">
                {UTANG_COPY.amountLabel}
              </span>
              <MoneyText value={detail.remaining} size="amount-sm" />
            </>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <PaidBar pct={detail.paidPct} thick />
          <span className="text-caption font-medium text-text-muted">
            {paidCaptionDetail(detail.paidPct, detail.paid, detail.principal, detail.settled)}
          </span>
        </div>
      </section>
      <div className="flex flex-col gap-2">
        {detail.settled ? null : slots.pay}
        {slots.edit}
        {slots.remove}
      </div>
      <RincianCard detail={detail} />
      <ListCard title={UTANG_COPY.history} icon={<ClockIcon size={18} />}>
        {payments.length === 0 ? (
          <EmptyLine>{UTANG_COPY.noPayments}</EmptyLine>
        ) : (
          <ul
            aria-label={
              detail.direction === 'lent'
                ? `Pembayaran dari ${detail.contactName}`
                : `Pembayaran utang ke ${detail.contactName}`
            }
          >
            {payments.map((p) => (
              <PaymentRow
                key={p.entryId}
                payment={p}
                detail={detail}
                ruang={ruang}
                query={query}
                cancel={slots.cancel}
              />
            ))}
          </ul>
        )}
        <p className="border-t border-hairline py-2.5 text-meta font-medium text-text-muted">
          {`Utang dicatat ${dateWithYear(detail.openedOn)}`}
        </p>
      </ListCard>
    </div>
  );
}

/** Galat muat detail (galat loader ditangkap page): salinan tetap + Coba lagi. */
export function UtangDetailFailed({ ruang, query }: { ruang: Ruang; query: string }) {
  return (
    <div className="flex flex-col gap-3 tablet:gap-4 laptop:max-w-180 laptop:pt-6">
      <BackLink href={buildDebtListHref(ruang, query)}>{UTANG_COPY.detailBack}</BackLink>
      <ErrorState
        title={UTANG_COPY.failedTitle}
        description={UTANG_COPY.failedDescription}
        actions={<RetryIsland />}
        headingLevel={1}
      />
    </div>
  );
}

/** Kerangka detail (`loading.tsx`): kartu utama dan tiga baris. */
export function UtangDetailLoading() {
  return (
    <div className="flex flex-col gap-3 tablet:gap-4 laptop:max-w-180 laptop:pt-6">
      <LoadingRegion label={UTANG_COPY.detailLoading}>
        <Skeleton className="h-44" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </LoadingRegion>
    </div>
  );
}
