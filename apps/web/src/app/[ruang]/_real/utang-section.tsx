import { todayWIB } from '@dompetku/domain';
import type { AccountVM, Ruang } from '@/features/ledger/types';
import { buildDebtListHref } from '@/features/shell/hrefs';
import type { ContactVM, DebtDetailVM, DebtListItemVM, PayTarget } from '@/features/utang/types';
import { rethrowOrNotFound } from '@/server/ledger/page-guard';
import { errorTag } from '@/server/ledger/transaksi';
import { loadUtang } from '@/server/ledger/utang';
import type { LedgerCtx } from '@/server/ledger/write';
import { ruangAccounts } from './context';
import {
  UtangDetailView,
  UtangFailed,
  UtangPageView,
  type DetailSlots,
  type ListSlots,
} from './utang';
import {
  AddDebtIsland,
  CancelPaymentIsland,
  DeleteDebtIsland,
  EditDebtIsland,
  PayDetailIsland,
  PayRowIsland,
  RestoreDebtIsland,
  UtangHostIsland,
} from './utang-islands';

/** Bagian utang yang dipakai sheet Bayar (tanpa kolom lain: payload klien kecil). */
export function payTargetOf(d: DebtListItemVM): PayTarget {
  return {
    debtId: d.debtId,
    contactName: d.contactName,
    direction: d.direction,
    principal: d.principal,
    remaining: d.remaining,
    quick: d.quick,
    openedOn: d.openedOn,
    accountId: d.accountId,
  };
}

const SLOTS: ListSlots = {
  add: (opts) => <AddDebtIsland {...opts} />,
  pay: (d) => <PayRowIsland debtId={d.debtId} name={d.contactName} direction={d.direction} />,
  restore: (d) => (
    <RestoreDebtIsland debtId={d.debtId} name={d.contactName} direction={d.direction} />
  ),
};

/**
 * Segmen Utang di Rencana (S11-UT1), dimuat HANYA saat bagiannya dibuka dan di dalam Suspense
 * halaman. Galat loader = `ErrorState` di dalam bagian (Segmen tetap tampil): Anggaran dan Tagihan
 * tidak ikut rusak. Redirect/404 dari gerbang tetap dilempar.
 */
export async function UtangSection({
  ctx,
  query,
}: {
  ctx: LedgerCtx & { ruang: Ruang };
  query: string;
}) {
  let loaded;
  try {
    const [data, accounts] = await Promise.all([loadUtang(ctx), ruangAccounts(ctx)]);
    loaded = { data, accounts };
  } catch (e) {
    rethrowOrNotFound(e);
    console.error('[utang] gagal memuat', errorTag(e));
    return <UtangFailed ruang={ctx.ruang} query={query} />;
  }
  const { data, accounts } = loaded;
  return (
    <UtangHostIsland
      ruang={ctx.ruang}
      today={todayWIB()}
      accounts={accounts}
      contacts={data.contacts}
      targets={data.debts.filter((d) => d.voidedAt === null).map(payTargetOf)}
      listHref={buildDebtListHref(ctx.ruang, query)}
    >
      <UtangPageView ruang={ctx.ruang} query={query} data={data} slots={SLOTS} />
    </UtangHostIsland>
  );
}

/** Detail utang dengan sheet dan dialognya (S11-DT1/DT2, AK1, AK2, BY1). */
export function UtangDetailHosted({
  ruang,
  query,
  detail,
  contacts,
  accounts,
}: {
  ruang: Ruang;
  query: string;
  detail: DebtDetailVM;
  contacts: ContactVM[];
  accounts: AccountVM[];
}) {
  const slots: DetailSlots = {
    pay: <PayDetailIsland debtId={detail.debtId} direction={detail.direction} />,
    edit: <EditDebtIsland />,
    remove: <DeleteDebtIsland />,
    cancel: (p) => <CancelPaymentIsland entryId={p.entryId} occurredOn={p.occurredOn} />,
  };
  return (
    <UtangHostIsland
      ruang={ruang}
      today={todayWIB()}
      accounts={accounts}
      contacts={contacts}
      targets={[detail]}
      detail={detail}
      listHref={buildDebtListHref(ruang, query)}
    >
      <UtangDetailView ruang={ruang} query={query} detail={detail} slots={slots} />
    </UtangHostIsland>
  );
}
