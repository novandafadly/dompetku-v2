import type { DemoState, DemoStore, Ruang } from '@dompetku/demo-data';
import type { IsoDate } from '@dompetku/domain';
import type { Route } from 'next';

/** Konteks demo yang diberikan halaman; fitur tidak mengimpor fitur lain. */
export interface TransaksiContext {
  state: DemoState;
  store: DemoStore;
  ruang: Ruang;
  today: IsoDate;
  listHref: Route;
  entryHref: (id: string) => Route;
}

export const RUANG_NAME: Record<Ruang, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };
