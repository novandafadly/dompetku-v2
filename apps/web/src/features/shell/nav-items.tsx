'use client';

import type { Icon } from '@/components/ui/icon';
import { CalendarCheckIcon } from '@/components/ui/icons/calendar-check';
import { HouseIcon } from '@/components/ui/icons/house';
import { ListBulletsIcon } from '@/components/ui/icons/list-bullets';
import { WalletIcon } from '@/components/ui/icons/wallet';
import type { Ruang } from '@dompetku/demo-data';
import { createContext, useContext } from 'react';
import type { Tab } from './hrefs';
import { useNav } from './nav-provider';

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

/**
 * Ruang yang punya anggaran atau tagihan. Hanya DemoProvider yang mengisinya; mode nyata belum
 * punya halaman Rencana, jadi tab itu tersembunyi.
 */
export const RencanaContext = createContext<Record<Ruang, boolean>>({
  pribadi: false,
  bersama: false,
});

/** Rencana tersembunyi selama ruang aktif belum punya anggaran maupun tagihan. */
export function useNavItems(): NavItem[] {
  const { ruang } = useNav();
  const hasRencana = useContext(RencanaContext)[ruang];
  return ALL.filter((i) => i.tab !== 'rencana' || hasRencana);
}
