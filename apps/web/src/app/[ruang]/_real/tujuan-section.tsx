import { todayWIB } from '@dompetku/domain';
import type { Ruang } from '@/features/ledger/types';
import { rethrowOrNotFound } from '@/server/ledger/page-guard';
import { errorTag } from '@/server/ledger/transaksi';
import { loadTujuan } from '@/server/ledger/tujuan';
import type { LedgerCtx } from '@/server/ledger/write';
import { ruangAccounts } from './context';
import { savingsOf, TujuanFailed, TujuanPageView, type TujuanSlots } from './tujuan';
import {
  AddGoalIsland,
  ArchiveGoalIsland,
  CompleteGoalIsland,
  EditGoalIsland,
  RestoreGoalIsland,
  TujuanHostIsland,
} from './tujuan-islands';

const SLOTS: TujuanSlots = {
  add: (opts) => <AddGoalIsland {...opts} />,
  complete: (g) => <CompleteGoalIsland goalId={g.goalId} name={g.name} />,
  edit: (g) => <EditGoalIsland goalId={g.goalId} name={g.name} />,
  archive: (g) => <ArchiveGoalIsland goalId={g.goalId} name={g.name} />,
  restore: (g) => <RestoreGoalIsland goalId={g.goalId} name={g.name} accountName={g.accountName} />,
};

/**
 * Segmen Tujuan di Rencana (S13-TJ1), dimuat HANYA saat bagiannya dibuka dan di dalam Suspense
 * halaman. Kedua ruang. Galat loader = `ErrorState` di dalam bagian (Segmen tetap tampil): Anggaran
 * dan Tagihan tidak ikut rusak. Redirect/404 dari gerbang tetap dilempar.
 */
export async function TujuanSection({
  ctx,
  query,
}: {
  ctx: LedgerCtx & { ruang: Ruang };
  query: string;
}) {
  let loaded;
  try {
    const [data, accounts] = await Promise.all([loadTujuan(ctx), ruangAccounts(ctx)]);
    loaded = { data, accounts };
  } catch (e) {
    rethrowOrNotFound(e);
    console.error('[tujuan] gagal memuat', errorTag(e));
    return <TujuanFailed ruang={ctx.ruang} query={query} />;
  }
  const { data, accounts } = loaded;
  const { free } = savingsOf(accounts, data.goals);
  return (
    <TujuanHostIsland
      ruang={ctx.ruang}
      today={todayWIB()}
      wallets={free.map((a) => ({ id: a.id, name: a.name, balance: a.balance }))}
      goals={data.goals.filter((g) => g.status === 'active')}
      partnerName={data.partnerName}
    >
      <TujuanPageView
        ruang={ctx.ruang}
        query={query}
        data={data}
        accounts={accounts}
        slots={SLOTS}
      />
    </TujuanHostIsland>
  );
}
