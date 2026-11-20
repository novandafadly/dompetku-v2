import type { IsoDate, Rupiah } from '@dompetku/domain';

/** View-model saham (S14 Task 10): semua angka dari `api.stock_overview`/`api.preview_sell` (SQL). */

export type StockSide = 'buy' | 'sell' | 'opening';

/** Satu transaksi hidup satu kode (terbaru dulu); hanya yang `lastTradeId` bisa dibatalkan. */
export interface StockTradeVM {
  id: string;
  side: StockSide;
  shares: number;
  price: Rupiah;
  occurredOn: IsoDate;
}

/** Satu kode saham di satu dompet saham. `shares = 0` = sudah dijual habis (hanya hasil terealisasi). */
export interface StockHoldingVM {
  holdingId: string;
  ticker: string;
  shares: number;
  costTotal: Rupiah;
  avgCost: Rupiah | null;
  /** Harga `ok` terakhir; null = belum ada harga (nilai pasar = biaya beli). */
  close: Rupiah | null;
  closeOn: IsoDate | null;
  /** Harga `ok` terakhir lebih dari 3 hari bursa. */
  stale: boolean;
  /** Ada harga yang ditahan (lonjakan) sesudah harga `ok` terakhir. */
  heldPending: boolean;
  heldOn: IsoDate | null;
  marketValue: Rupiah;
  /** Untung/rugi belum terealisasi (bertanda); null bila belum ada harga. */
  unrealized: Rupiah | null;
  /** Untung/rugi sudah terealisasi (bertanda). */
  realized: Rupiah;
  /** Transaksi hidup terakhir (satu-satunya yang bisa dibatalkan). */
  lastTradeId: string | null;
  trades: StockTradeVM[];
}

export interface StockTotalVM {
  costTotal: Rupiah;
  marketValue: Rupiah;
  /** Σ belum terealisasi dari kode berharga; null bila tidak ada satu pun harga. */
  unrealized: Rupiah | null;
  realized: Rupiah;
  /** Ada kode berlembar yang harganya lama / yang ditahan / yang belum berharga. */
  stale: boolean;
  heldPending: boolean;
  missingPriceCount: number;
}

export interface StockOverviewVM {
  /** Urutan SQL: nilai pasar terbesar dulu; berlembar 0 di akhir. */
  holdings: StockHoldingVM[];
  total: StockTotalVM;
}

/** Pratinjau jual dari `api.preview_sell` (rumus yang sama dengan jual). */
export interface SellPreviewVM {
  costRemoved: Rupiah;
  proceeds: Rupiah;
  realized: Rupiah;
}
