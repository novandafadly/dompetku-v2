'use client';

import type { DemoState } from '@dompetku/demo-data';
import { memberContributions } from '@dompetku/demo-data/select/kontribusi';
import { endOfMonth, monthName, type IsoDate } from '@dompetku/domain';
import { ContributionCardView } from '@/features/bersama/contribution-card-view';
import type { ContributionVM } from '@/features/bersama/types';

/**
 * Kartu Kontribusi prototipe Bersama (S8-K1): definisi K2 atas seed demo, dirangkai ke
 * `ContributionVM` yang sama dengan mode nyata. Dimuat malas dari `view.tsx` (budget Beranda
 * prototipe); selector diimpor lewat berkas langsung, bukan barrel. Di `app/` (bukan `features/`)
 * karena menyambung fitur beranda dan bersama (aturan boundaries).
 */
export function ContributionDemo({ state, today }: { state: DemoState; today: IsoDate }) {
  const from = `${today.slice(0, 7)}-01`;
  const to = endOfMonth(today);
  const byMember = new Map(memberContributions(state, from, to).map((r) => [r.memberId, r]));
  const rows = state.members.map((m, i) => ({
    member: { id: m.id, name: m.name, initial: m.initial, role: i === 0 ? 'owner' : 'member' },
    setoran: byMember.get(m.id)?.setoran ?? 0,
    diambil: byMember.get(m.id)?.diambil ?? 0,
  })) satisfies ContributionVM['rows'];
  const vm: ContributionVM = {
    period: { from, to, label: monthName(today.slice(0, 7)) },
    rows,
    allZero: rows.every((r) => r.setoran === 0 && r.diambil === 0),
  };
  return <ContributionCardView vm={vm} />;
}
