import type { IsoDate, Rupiah } from '@dompetku/domain';
import type { ActionResult, AccountVM, Ruang } from '@/features/ledger/types';
import type { SellPreviewVM, StockHoldingVM } from './types';

/** Data yang dibawa pulau saham: dompet saham ini, dompet kas pilihan, dan kode yang dipegang. */
export interface CashOption {
  id: string;
  name: string;
  pocket: 'operasional' | 'tabungan' | 'trading';
  balance: Rupiah;
  openedOn: IsoDate;
}

/** Satu kode yang dipegang (lembar > 0) untuk pemilih dan teks pembanding di sheet. */
export interface HoldingLite {
  ticker: string;
  shares: number;
  close: Rupiah | null;
  closeOn: IsoDate | null;
}

export interface StockAccount {
  id: string;
  name: string;
  openedOn: IsoDate;
}

export interface StockScope {
  ruang: Ruang;
  today: IsoDate;
  account: StockAccount;
  cash: CashOption[];
  /** Kode berlembar > 0 (semua untuk tombol tingkat dompet, satu untuk tombol per baris). */
  holdings: HoldingLite[];
  /** Tanggal transaksi hidup terakhir per kode (termasuk yang sudah dijual habis): batas awal tanggal baru. */
  lastTradeOn: Record<string, IsoDate>;
}

/**
 * Dompet kas yang boleh jadi sumber/tujuan saham (DB: operasional, tabungan, trading; K7); trading
 * lebih dulu karena RDN biasanya sumber pembelian. Terarsip dan dompet lain (Kantor, aset, patungan)
 * tidak ditawarkan.
 */
export function cashOptions(accounts: readonly AccountVM[]): CashOption[] {
  const rank = { trading: 0, operasional: 1, tabungan: 2 } as const;
  return accounts
    .filter(
      (a) =>
        !a.archived &&
        (a.pocket === 'trading' || a.pocket === 'operasional' || a.pocket === 'tabungan'),
    )
    .map((a): CashOption => ({
      id: a.id,
      name: a.name,
      pocket: a.pocket as CashOption['pocket'],
      balance: a.balance,
      openedOn: a.openedOn,
    }))
    .sort((x, y) => rank[x.pocket] - rank[y.pocket]);
}

export function holdingLite(h: StockHoldingVM): HoldingLite {
  return {
    ticker: h.ticker,
    shares: h.shares,
    close: h.close,
    closeOn: h.closeOn,
  };
}

/** Tanggal ISO terbesar (perbandingan teks `YYYY-MM-DD`). */
export function latestOf(...dates: (IsoDate | null | undefined)[]): IsoDate {
  return dates.reduce<IsoDate>((acc, d) => (d != null && d > acc ? d : acc), '2020-01-01');
}

/** Hasil aksi yang dipakai sheet: bentuk sama dengan `ActionResult`, tanpa mengimpor server action. */
export interface StockSource {
  buy(req: {
    clientId: string;
    accountId: string;
    ticker: string;
    shares: number;
    price: Rupiah;
    fee: Rupiah;
    fromAccountId: string;
    on?: IsoDate;
    allowNegative: boolean;
  }): Promise<ActionResult<{ amount: number }>>;
  sell(req: {
    clientId: string;
    accountId: string;
    ticker: string;
    shares: number;
    price: Rupiah;
    fee: Rupiah;
    tax: Rupiah;
    toAccountId: string;
    on?: IsoDate;
  }): Promise<ActionResult<{ proceeds: number; realized: number }>>;
  open(req: {
    clientId: string;
    accountId: string;
    ticker: string;
    shares: number;
    price: Rupiah;
    on?: IsoDate;
  }): Promise<ActionResult<{ amount: number }>>;
  preview(req: {
    accountId: string;
    ticker: string;
    shares: number;
    price: Rupiah;
    fee: Rupiah;
    tax: Rupiah;
  }): Promise<ActionResult<SellPreviewVM>>;
  setPrice(req: {
    clientId: string;
    ticker: string;
    close: Rupiah;
    on?: IsoDate;
    confirmSpike: boolean;
  }): Promise<ActionResult<{ onDate: string }>>;
  voidTrade(req: {
    clientId: string;
    tradeId: string;
    allowNegative: boolean;
  }): Promise<ActionResult<{ tradeId: string }>>;
  restoreTrade(req: {
    clientId: string;
    tradeId: string;
    allowNegative: boolean;
  }): Promise<ActionResult<{ tradeId: string }>>;
}

/** Tanggal transaksi terakhir per kode dari daftar posisi (terbaru dulu di `trades`). */
export function lastTradeOnOf(holdings: readonly StockHoldingVM[]): Record<string, IsoDate> {
  const out: Record<string, IsoDate> = {};
  for (const h of holdings) {
    const d = h.trades[0]?.occurredOn;
    if (d !== undefined) out[h.ticker] = d;
  }
  return out;
}
