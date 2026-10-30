import type { DemoState, DemoStore, Ruang } from '@dompetku/demo-data';
import type { IsoDate } from '@dompetku/domain';

/** Konteks demo yang diberikan halaman; fitur tidak mengimpor fitur lain. */
export interface BerandaContext {
  state: DemoState;
  store: DemoStore;
  ruang: Ruang;
  today: IsoDate;
}
