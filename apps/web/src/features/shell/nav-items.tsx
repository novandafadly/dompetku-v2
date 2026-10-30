'use client';

import { HouseIcon, ReceiptIcon, TargetIcon, WalletIcon, type Icon } from '@phosphor-icons/react';
import { useDemo } from './demo-provider';
import type { Tab } from './hrefs';

export interface NavItem {
  tab: Tab;
  label: string;
  Icon: Icon;
}

const ALL: NavItem[] = [
  { tab: 'beranda', label: 'Beranda', Icon: HouseIcon },
  { tab: 'transaksi', label: 'Transaksi', Icon: ReceiptIcon },
  { tab: 'dompet', label: 'Dompet', Icon: WalletIcon },
  { tab: 'rencana', label: 'Rencana', Icon: TargetIcon },
];

/** Rencana tersembunyi selama ruang aktif belum punya anggaran maupun tagihan. */
export function useNavItems(): NavItem[] {
  const { state, ruang } = useDemo();
  const hasRencana =
    state.budgets.some((b) => b.ruang === ruang) || state.bills.some((b) => b.ruang === ruang);
  return ALL.filter((i) => i.tab !== 'rencana' || hasRencana);
}
