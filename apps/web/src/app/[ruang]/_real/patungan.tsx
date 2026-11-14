import { formatRupiah, type IsoDate } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { buttonClass } from '@/components/ui/button';
import { CategoryIcon } from '@/components/ui/category-icon';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { ClockIcon } from '@/components/ui/icons/clock';
import { HandCoinsIcon } from '@/components/ui/icons/hand-coins';
import { ReceiptIcon } from '@/components/ui/icons/receipt';
import { ListCard } from '@/components/ui/list-card';
import { SpaceTag } from '@/components/ui/space-tag';
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/ui/state';
import { card, focusRing, heroCard, rowDivider, tile } from '@/components/ui/styles';
import { dateLabel, debtSentence, PATUNGAN_COPY as C } from '@/features/patungan/copy';
import { partnerShareOf } from '@/features/patungan/present';
import type {
  PatunganData,
  SplitBalanceVM,
  SplitBillVM,
  SplitHistoryItemVM,
  SplitSettlementVM,
} from '@/features/patungan/types';
import { buildAuthHref, buildEntryHref } from '@/features/shell/hrefs';
import { RetryIsland } from './transaksi-islands';
import { PATUNGAN_TITLE_ID } from './patungan-ids';
import {
  CatatIsland,
  PatunganHostIsland,
  ReceiveIsland,
  RestoreSplitIsland,
  RowActionIsland,
  SettleIsland,
} from './patungan-islands';

/**
 * Halaman `/bersama/patungan` mode nyata (S12-PT2; Server Component). Riwayat dari
 * `api.split_history`, paginasi tautan (`Muat lagi`). Sheet Lunasi/Terima dan dialog akibat adalah
 * pulau klien yang dimuat malas; baris hanya menampilkan data Bersama (tanpa nama atau saldo
 * dompet Pribadi mana pun). Tanpa merah untuk saldo dan utang; status = ikon + teks.
 */

const WIDTH = 'flex flex-col gap-3 tablet:gap-4 laptop:max-w-180';

function Header({ backHref }: { backHref: Route }) {
  return (
    <>
      <BackLink href={backHref}>Beranda</BackLink>
      <h1
        id={PATUNGAN_TITLE_ID}
        tabIndex={-1}
        className="text-headline font-extrabold text-text outline-none laptop:text-title-lg"
      >
        {C.pageTitle}
      </h1>
    </>
  );
}

function nameOf(id: string, vm: SplitBalanceVM, capital = false): string {
  if (id === vm.me.id) return capital ? 'Kamu' : 'kamu';
  return vm.partner.name;
}

function StatusMark({ received }: { received: boolean }) {
  return received ? (
    <span className="inline-flex items-center gap-1 font-semibold text-accent-text">
      <CheckCircleIcon size={14} weight="fill" className="shrink-0" />
      {C.received}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 font-semibold text-warning">
      <ClockIcon size={14} className="shrink-0" />
      {C.waiting}
    </span>
  );
}

function BalanceHero({ vm }: { vm: SplitBalanceVM }) {
  const sentence = vm.amount === null ? null : debtSentence(vm, vm.amount);
  const iDebtor = vm.debtorId === vm.me.id;
  return (
    <section aria-labelledby="patungan-saldo" className={`flex flex-col gap-3 p-4 ${heroCard}`}>
      <div className="flex items-center gap-2">
        <h2 id="patungan-saldo" className="text-label font-medium text-text-soft">
          {C.title}
        </h2>
        <SpaceTag space="bersama" />
      </div>
      {sentence === null ? (
        <p className="flex items-center gap-2 text-headline font-extrabold text-accent-text">
          <CheckCircleIcon size={22} weight="fill" className="shrink-0" />
          {C.impas}
        </p>
      ) : (
        <p className="text-headline font-extrabold text-text min-[390px]:text-title-lg">
          {sentence.before}
          <span className="whitespace-nowrap">{sentence.amount}</span>
          {sentence.after}
        </p>
      )}
      {iDebtor && vm.amount !== null ? (
        <SettleIsland label={`${C.settle} ${formatRupiah(vm.amount)}`} />
      ) : null}
    </section>
  );
}

function Pending({ vm }: { vm: SplitBalanceVM }) {
  if (vm.pending.length === 0) return null;
  return (
    <ListCard title={C.waiting} icon={<ClockIcon size={18} />}>
      <ul>
        {vm.pending.map((p) => {
          const mine = p.toId === vm.me.id;
          return (
            <li key={p.id} className={`flex min-h-15.5 items-center gap-3 py-2 ${rowDivider}`}>
              <span aria-hidden="true" className={`size-11 ${tile}`}>
                <HandCoinsIcon size={20} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-body/tight font-semibold text-text">
                  {`${nameOf(p.fromId, vm, true)} melunasi `}
                  <span className="whitespace-nowrap">{formatRupiah(p.amount)}</span>
                </span>
                <span className="text-meta font-medium text-text-muted">
                  {dateLabel(p.occurredOn)}
                </span>
              </span>
              {mine ? (
                <ReceiveIsland
                  settlementId={p.id}
                  label={`Terima pelunasan dari ${vm.partner.name}`}
                />
              ) : (
                <span className="inline-flex items-center gap-1 text-meta font-semibold text-warning">
                  <ClockIcon size={14} className="shrink-0" />
                  {`Menunggu ${vm.partner.name}`}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </ListCard>
  );
}

function BillBody({ bill, vm }: { bill: SplitBillVM; vm: SplitBalanceVM }) {
  const other = bill.payerId === vm.me.id ? vm.partner.name : 'kamu';
  const label = bill.description ?? bill.categoryName ?? 'Tagihan patungan';
  return (
    <>
      <span aria-hidden="true" className={`size-11 ${tile}`}>
        <CategoryIcon name={bill.categoryName ?? undefined} kind="expense" size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-body/tight font-semibold break-words text-text">
          {label}
        </span>
        <span className="text-meta font-medium text-text-muted">
          {`Dibayar ${nameOf(bill.payerId, vm)} · bagian ${other} ${formatRupiah(partnerShareOf(bill))} · ${dateLabel(bill.occurredOn)}`}
        </span>
      </span>
      <span className="text-label font-bold whitespace-nowrap text-text">
        {formatRupiah(bill.amount)}
      </span>
    </>
  );
}

function SettlementBody({ s, vm }: { s: SplitSettlementVM; vm: SplitBalanceVM }) {
  return (
    <>
      <span aria-hidden="true" className={`size-11 ${tile}`}>
        <HandCoinsIcon size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body/tight font-semibold break-words text-text">
          {`${nameOf(s.fromId, vm, true)} melunasi ke ${nameOf(s.toId, vm)}`}
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-meta font-medium text-text-muted">
          {dateLabel(s.occurredOn)}
          <span aria-hidden="true">·</span>
          {s.voidedAt === null ? (
            <StatusMark received={s.received} />
          ) : (
            <span className="font-semibold">Dibatalkan</span>
          )}
        </span>
      </span>
      <span className="text-label font-bold whitespace-nowrap text-text">
        {formatRupiah(s.amount)}
      </span>
    </>
  );
}

const ROW_BODY = `-mx-4 flex min-h-15.5 min-w-0 items-center gap-3 px-4 py-2 hover-pointer:bg-hover active:bg-hover ${focusRing}`;

function HistoryRow({
  item,
  vm,
  query,
  deleted = false,
}: {
  item: SplitHistoryItemVM;
  vm: SplitBalanceVM;
  query: string;
  deleted?: boolean;
}) {
  let body: ReactNode;
  let action: ReactNode = null;
  if (item.item === 'split') {
    const href = buildEntryHref('bersama', item.expenseEntryId, query);
    const label = item.description ?? item.categoryName ?? 'tagihan';
    body = deleted ? (
      <div className="-mx-4 flex min-h-15.5 min-w-0 items-center gap-3 px-4 py-2">
        <BillBody bill={item} vm={vm} />
      </div>
    ) : (
      <Link href={href} className={ROW_BODY}>
        <BillBody bill={item} vm={vm} />
      </Link>
    );
    if (item.payerId === vm.me.id) {
      action = deleted ? (
        <RestoreSplitIsland splitId={item.id} ariaLabel={`Pulihkan tagihan patungan ${label}`} />
      ) : (
        <RowActionIsland
          kind="delete"
          id={item.id}
          label={C.delete}
          ariaLabel={`Hapus tagihan patungan ${label}`}
        />
      );
    }
  } else {
    body = (
      <div className="-mx-4 flex min-h-15.5 min-w-0 items-center gap-3 px-4 py-2">
        <SettlementBody s={item} vm={vm} />
      </div>
    );
    if (!deleted && item.fromId === vm.me.id) {
      action = item.received ? (
        <p className="py-1 text-meta font-medium text-text-muted">
          {`Sudah diterima ${vm.partner.name}. Minta ${vm.partner.name} membatalkan penerimaannya dulu.`}
        </p>
      ) : (
        <RowActionIsland
          kind="cancel-settle"
          id={item.id}
          label={C.cancel}
          ariaLabel={`Batalkan pelunasan ${dateLabel(item.occurredOn)}`}
        />
      );
    } else if (!deleted && item.toId === vm.me.id) {
      action = item.received ? (
        <RowActionIsland
          kind="cancel-receipt"
          id={item.id}
          label={C.cancel}
          ariaLabel={`Batalkan penerimaan dari ${vm.partner.name}`}
        />
      ) : (
        <ReceiveIsland settlementId={item.id} label={`Terima pelunasan dari ${vm.partner.name}`} />
      );
    }
  }
  return (
    <li className={rowDivider}>
      {body}
      {action === null ? null : (
        <div className="flex flex-wrap justify-end gap-2 pb-2">{action}</div>
      )}
    </li>
  );
}

export function PatunganReal({
  data,
  query,
  today,
  backHref,
  olderHref,
  newestHref,
  initial,
}: {
  data: PatunganData;
  query: string;
  today: IsoDate;
  backHref: Route;
  olderHref: Route | null;
  newestHref: Route | null;
  initial: { lunasi: boolean; terima: string | null };
}) {
  const { balance } = data;
  if (balance === null) {
    return (
      <section className={WIDTH}>
        <Header backHref={backHref} />
        <EmptyState
          icon={<ReceiptIcon size={28} />}
          title={C.soloTitle}
          headingLevel={2}
          description={C.soloHint(null)}
          action={
            <Link href={buildAuthHref('undang', query)} className={buttonClass('primary')}>
              {C.inviteAction}
            </Link>
          }
        />
      </section>
    );
  }
  const empty = data.history.length === 0 && data.deleted.length === 0 && newestHref === null;
  return (
    <PatunganHostIsland
      today={today}
      balance={balance}
      items={[...data.history, ...data.deleted]}
      initial={initial}
    >
      <section className={WIDTH}>
        <Header backHref={backHref} />
        {empty ? (
          <EmptyState
            tone="accent"
            icon={<ReceiptIcon size={28} />}
            title={C.empty}
            headingLevel={2}
            description={C.emptyHint}
            action={<CatatIsland label={C.emptyAction} />}
          />
        ) : (
          <>
            <BalanceHero vm={balance} />
            <Pending vm={balance} />
            {newestHref === null ? null : (
              <Link
                href={newestHref}
                prefetch={false}
                className={buttonClass('secondary', 'sm', 'self-start')}
              >
                Kembali ke terbaru
              </Link>
            )}
            <ListCard title={C.history} icon={<ClockIcon size={18} />}>
              {data.history.length === 0 ? (
                <p className="py-3 text-label font-medium text-text-muted">{C.empty}</p>
              ) : (
                <ul>
                  {data.history.map((i) => (
                    <HistoryRow key={i.id} item={i} vm={balance} query={query} />
                  ))}
                </ul>
              )}
            </ListCard>
            {olderHref === null ? null : (
              <Link
                href={olderHref}
                prefetch={false}
                className={buttonClass('secondary', 'md', 'self-start')}
              >
                {C.more}
              </Link>
            )}
            {data.deleted.length === 0 ? null : (
              <details className={`${card} px-4`}>
                <summary
                  className={`flex min-h-11 cursor-pointer items-center text-label font-bold text-text-soft ${focusRing}`}
                >
                  {C.deletedGroup(data.deleted.length)}
                </summary>
                <ul>
                  {data.deleted.map((i) => (
                    <HistoryRow key={i.id} item={i} vm={balance} query={query} deleted />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>
    </PatunganHostIsland>
  );
}

/** Gagal muat (galat loader ditangkap page): salinan tetap + Coba lagi (`router.refresh`). */
export function PatunganFailed({ backHref }: { backHref: Route }) {
  return (
    <section className={WIDTH}>
      <Header backHref={backHref} />
      <ErrorState title={C.loadFailed} description={C.loadFailedHint} actions={<RetryIsland />} />
    </section>
  );
}

/** Kerangka selama server memuat (`loading.tsx`): tanpa judul (ruangnya belum diketahui). */
export function PatunganLoading() {
  return (
    <section className={WIDTH}>
      <LoadingRegion label={C.loading}>
        <Skeleton className="h-28" />
        <Skeleton className="h-15.5" />
        <Skeleton className="h-15.5" />
        <Skeleton className="h-15.5" />
      </LoadingRegion>
    </section>
  );
}
