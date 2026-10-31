'use client';

import type { Icon } from '@/components/ui/icon';
import { CalendarCheckIcon } from '@/components/ui/icons/calendar-check';
import { HouseIcon } from '@/components/ui/icons/house';
import { ListBulletsIcon } from '@/components/ui/icons/list-bullets';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { useDemo } from './demo-provider';
import type { Tab } from './hrefs';

export interface NavItem {
  tab: Tab;
  label: string;
  Icon: Icon;
}

const ALL: NavItem[] = [
  { tab: 'beranda', label: 'Beranda', Icon: HouseIcon },
  { tab: 'transaksi', label: 'Transaksi', Icon: ListBulletsIcon },
  { tab: 'dompet', label: 'Dompet', Icon: WalletIcon },
  { tab: 'rencana', label: 'Rencana', Icon: CalendarCheckIcon },
];

/** Rencana tersembunyi selama ruang aktif belum punya anggaran maupun tagihan. */
export function useNavItems(): NavItem[] {
  const { state, ruang } = useDemo();
  const hasRencana =
    state.budgets.some((b) => b.ruang === ruang) || state.bills.some((b) => b.ruang === ruang);
  return ALL.filter((i) => i.tab !== 'rencana' || hasRencana);
}
