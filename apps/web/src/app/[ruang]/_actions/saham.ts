'use server';

import type { z } from 'zod';
import type { ActionResult } from '@/features/ledger/types';
import type { SellPreviewVM } from '@/features/saham/types';
import {
  buyStock,
  buyStockSchema,
  openHoldingSchema,
  openStockHolding,
  previewSell,
  previewSellSchema,
  restoreStockTrade,
  sellStock,
  sellStockSchema,
  setPriceSchema,
  setStockPrice,
  tradeActionSchema,
  voidStockTrade,
  type BuyStockValue,
  type OpenHoldingValue,
  type SellStockValue,
  type SetPriceValue,
} from '@/server/ledger/saham';
import { actionContext, ledger, mutate, parseInput, query } from './context';

/**
 * Server Action Saham (S14 Task 10; endpoint publik, pola di `context.ts`). Saham hanya Pribadi
 * (DB: `pocket_personal_only`/`asset_account_invalid` di ruang lain). Galat = kode tanpa nominal,
 * nama, atau kode saham (`insufficient_shares`, `trade_not_latest`, `price_spike_unconfirmed`,
 * `saldo_negatif`, ...); salinan dipilih UI (`features/saham/galat.ts`). Nominal hasil (total keluar,
 * hasil bersih, untung/rugi) dihitung DB dan hanya dipakai untuk toast.
 */

/** Beli: transfer dompet sumber -> dompet saham. `clientId` stabil per pembukaan sheet. */
export async function buyStockAction(
  ruang: unknown,
  input: z.input<typeof buyStockSchema>,
): Promise<ActionResult<BuyStockValue>> {
  return mutate('buyStockAction', actionContext(ruang), async (ctx) =>
    buyStock(ledger(ctx), parseInput(buyStockSchema, input)),
  );
}

/** Jual: untung/rugi + transfer hasil ke dompet tujuan (satu transaksi). */
export async function sellStockAction(
  ruang: unknown,
  input: z.input<typeof sellStockSchema>,
): Promise<ActionResult<SellStockValue>> {
  return mutate('sellStockAction', actionContext(ruang), async (ctx) =>
    sellStock(ledger(ctx), parseInput(sellStockSchema, input)),
  );
}

/** Saham yang sudah dimiliki sebelum memakai DompetKu (tanpa efek kas). */
export async function openStockHoldingAction(
  ruang: unknown,
  input: z.input<typeof openHoldingSchema>,
): Promise<ActionResult<OpenHoldingValue>> {
  return mutate('openStockHoldingAction', actionContext(ruang), async (ctx) =>
    openStockHolding(ledger(ctx), parseInput(openHoldingSchema, input)),
  );
}

/** Pratinjau jual dari SQL (baca, tanpa refresh). */
export async function previewSellAction(
  ruang: unknown,
  input: z.input<typeof previewSellSchema>,
): Promise<ActionResult<SellPreviewVM>> {
  return query('previewSellAction', actionContext(ruang), async (ctx) =>
    previewSell(ledger(ctx), parseInput(previewSellSchema, input)),
  );
}

/** Harga penutupan manual (per ruang); lonjakan > 35% butuh `confirmSpike`. */
export async function setStockPriceAction(
  ruang: unknown,
  input: z.input<typeof setPriceSchema>,
): Promise<ActionResult<SetPriceValue>> {
  return mutate('setStockPriceAction', actionContext(ruang), async (ctx) =>
    setStockPrice(ledger(ctx), parseInput(setPriceSchema, input)),
  );
}

/** Batalkan transaksi saham hidup terakhir satu kode. */
export async function voidStockTradeAction(
  ruang: unknown,
  input: z.input<typeof tradeActionSchema>,
): Promise<ActionResult<{ tradeId: string }>> {
  return mutate('voidStockTradeAction', actionContext(ruang), async (ctx) =>
    voidStockTrade(ledger(ctx), parseInput(tradeActionSchema, input)),
  );
}

/** Pulihkan transaksi saham batal (Urungkan, Sampah). */
export async function restoreStockTradeAction(
  ruang: unknown,
  input: z.input<typeof tradeActionSchema>,
): Promise<ActionResult<{ tradeId: string }>> {
  return mutate('restoreStockTradeAction', actionContext(ruang), async (ctx) =>
    restoreStockTrade(ledger(ctx), parseInput(tradeActionSchema, input)),
  );
}
