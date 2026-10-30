import type { DemoState, DemoStore, Ruang } from '@dompetku/demo-data';
import type { IsoDate } from '@dompetku/domain';

/** Konteks demo yang diberikan halaman; fitur tidak mengimpor fitur lain. */
export interface DompetContext {
  state: DemoState;
  store: DemoStore;
  ruang: Ruang;
  today: IsoDate;
}

export const RUANG_NAME: Record<Ruang, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };

export const POCKET_LABEL = {
  operasional: 'Operasional',
  tabungan: 'Tabungan',
  kantor: 'Kantor',
} as const;

export const WALLET_TYPE_LABEL = { bank: 'Bank', ewallet: 'E-wallet', cash: 'Tunai' } as const;
