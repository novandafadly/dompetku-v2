'use client';

import type { Icon } from '@/components/ui/icon';
import { CalendarCheckIcon } from '@/components/ui/icons/calendar-check';
import { HouseIcon } from '@/components/ui/icons/house';
import { ListBulletsIcon } from '@/components/ui/icons/list-bullets';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { useContext } from 'react';
import type { Tab } from './hrefs';
import { useNav } from './nav-provider';
import { RencanaContext } from './rencana-context';

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
  const { ruang } = useNav();
  const hasRencana = useContext(RencanaContext)[ruang];
  return ALL.filter((i) => i.tab !== 'rencana' || hasRencana);
}
