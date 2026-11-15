import type { IsoDate } from '@dompetku/domain';
import Link from 'next/link';
import { FlagBannerIcon } from '@/components/ui/icons/flag-banner';
import { card, focusRing } from '@/components/ui/styles';
import type { Ruang } from '@/features/ledger/types';
import { TUJUAN_COPY as C } from '@/features/tujuan/copy';
import { GoalCardView } from '@/features/tujuan/goal-card-view';
import { buildGoalListHref } from '@/features/tujuan/hrefs';
import type { GoalVM } from '@/features/tujuan/types';
import { AddGoalIsland, TujuanHostIsland } from './tujuan-islands';
import { SLOTS } from './tujuan-section';

/**
 * Kartu tujuan di Detail dompet tabungan (S13-TJ9, Server Component; sheet/dialog = pulau malas
 * `tujuan-client`, sama dengan Rencana). Tujuan aktif = kartu progres yang sama dengan Rencana (tanpa
 * `Lihat dompet`); belum ada = ajakan `Buat tujuan` yang membuka sheet Tambah dengan dompet terkunci.
 * Angka dari `api.goal_for_account`, tidak dihitung di sini.
 */
export function DompetGoalCard({
  ruang,
  query,
  today,
  account,
  goal,
  partnerName,
}: {
  ruang: Ruang;
  query: string;
  today: IsoDate;
  account: { id: string; name: string; balance: number };
  goal: GoalVM | null;
  partnerName: string | null;
}) {
  return (
    <TujuanHostIsland
      ruang={ruang}
      today={today}
      wallets={goal === null ? [account] : []}
      goals={goal === null ? [] : [goal]}
      partnerName={partnerName}
      lockedWalletId={account.id}
    >
      {goal === null ? (
        <section aria-label="Tujuan" className={`flex flex-col gap-2 p-4 ${card}`}>
          <div className="flex flex-col gap-0.5">
            <p className="flex items-start gap-2 text-body font-semibold text-text">
              <FlagBannerIcon size={18} className="mt-px shrink-0 text-text-soft" />
              <span className="min-w-0 break-words">{C.walletNoGoal(account.name)}</span>
            </p>
            <p className="text-meta font-medium text-text-soft">{C.walletNoGoalHint}</p>
          </div>
          <AddGoalIsland variant="secondary" label={C.create} className="self-start" />
        </section>
      ) : (
        <div className="flex flex-col gap-0.5">
          <GoalCardView goal={goal} ruang={ruang} slots={SLOTS} walletHref={null} />
          <Link
            href={buildGoalListHref(ruang, query)}
            className={`inline-flex min-h-11 items-center self-start rounded-md px-1 text-label font-bold text-accent-text hover-pointer:underline ${focusRing}`}
          >
            {C.viewAll}
          </Link>
        </div>
      )}
    </TujuanHostIsland>
  );
}
