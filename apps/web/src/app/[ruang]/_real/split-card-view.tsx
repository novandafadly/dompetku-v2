import Link from 'next/link';
import { buttonClass } from '@/components/ui/button';
import { CaretRightIcon } from '@/components/ui/icons/caret-right';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { ReceiptIcon } from '@/components/ui/icons/receipt';
import { ListCard } from '@/components/ui/list-card';
import { focusRing } from '@/components/ui/styles';
import { CardError } from '@/features/bersama/card-error';
import { MemberAvatar } from '@/features/bersama/member-avatar';
import {
  debtSentence,
  PATUNGAN_COPY as C,
  pendingLine,
  settledCounts,
} from '@/features/ledger/patungan-copy';
import type { SplitBalanceVM } from '@/features/ledger/patungan-types';
import { buildPatunganHref } from '@/features/shell/patungan-hrefs';

/**
 * Kartu `Saldo patungan` di Beranda Bersama (S12-PT1): Server Component murni, tanpa JS baru.
 * Kalimat dan nominal dari SQL (`api.shared_balances`), netral tanpa merah (arah dibawa kata).
 * `Lunasi` dan `Terima` adalah tautan ke halaman Patungan yang membuka sheetnya (`?lunasi=1`,
 * `?terima=id`), jadi Beranda tidak membawa kode sheet (budget JS). Tersembunyi bila belum pernah
 * ada patungan (kartu tidak dirender; `null`).
 */
export function SplitCard({ vm, query }: { vm: SplitBalanceVM; query: string }) {
  if (vm.splitCount === 0 && vm.settlementCount === 0 && vm.pending.length === 0) return null;
  const debtor = vm.debtorId === null ? null : vm.debtorId === vm.me.id ? vm.me : vm.partner;
  const sentence = vm.amount === null || debtor === null ? null : debtSentence(vm, vm.amount);
  const iDebtor = vm.debtorId === vm.me.id;
  // Pelunasan yang menunggu diterima olehku (ditujukan kepadaku).
  const waitingForMe = vm.pending.find((p) => p.toId === vm.me.id);
  return (
    <ListCard title={C.title} icon={<ReceiptIcon size={18} />}>
      <div className="flex flex-col gap-2 pt-1 pb-1">
        {sentence === null || debtor === null ? (
          <p className="flex items-center gap-1.5 text-body font-bold text-accent-text">
            <CheckCircleIcon size={16} weight="fill" className="shrink-0" />
            {C.impas}
          </p>
        ) : (
          <div className="flex items-start gap-3">
            <MemberAvatar
              role={debtor.id === vm.me.id ? 'owner' : 'member'}
              initial={debtor.initial}
            />
            <p className="min-w-0 text-body font-bold text-text">
              {sentence.before}
              <span className="whitespace-nowrap">{sentence.amount}</span>
              {sentence.after}
            </p>
          </div>
        )}
        <p className="text-caption font-medium text-text-muted">
          {settledCounts(vm.splitCount, vm.settlementCount)}
        </p>
        {waitingForMe === undefined ? null : (
          <p className="text-meta font-semibold text-text">
            {pendingLine(vm.partner.name, waitingForMe.amount)}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 pb-1">
        {iDebtor ? (
          <Link
            href={buildPatunganHref(query, 'lunasi')}
            aria-label={`${C.settle} patungan ke ${vm.partner.name}`}
            className={buttonClass('secondary', 'sm')}
          >
            {C.settle}
          </Link>
        ) : null}
        {waitingForMe === undefined ? null : (
          <Link
            href={buildPatunganHref(query, { terima: waitingForMe.id })}
            className={buttonClass('secondary', 'sm')}
          >
            {C.receive}
          </Link>
        )}
        <Link
          href={buildPatunganHref(query)}
          className={`inline-flex min-h-11 items-center gap-0.5 rounded-md px-2 text-meta font-bold text-accent-text hover-pointer:underline ${focusRing}`}
        >
          {C.see}
          <CaretRightIcon size={16} weight="bold" />
        </Link>
      </div>
    </ListCard>
  );
}

/** Galat bacaan saldo (savepoint): kartu lain dan Aman dipakai tetap. */
export function SplitCardError({ retryHref }: { retryHref: string }) {
  return (
    <ListCard title={C.title} icon={<ReceiptIcon size={18} />}>
      <CardError message={C.cardFailed} retryHref={retryHref} />
    </ListCard>
  );
}
