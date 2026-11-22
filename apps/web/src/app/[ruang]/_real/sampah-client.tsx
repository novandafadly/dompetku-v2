'use client';

import type { IsoDate } from '@dompetku/domain';
import { useRouter } from 'next/navigation';
import type { AccountVM, Ruang, TrashVM } from '@/features/ledger/types';
import { restoreEntryAction } from '../_actions/entri';
import { restoreStockTradeAction } from '../_actions/saham';
import { TrashList } from '../sampah/trash-parts';

/**
 * Daftar Sampah nyata (pulau klien, dimuat malas lewat `sampah-islands`): `Pulihkan` =
 * `restoreEntryAction` (transaksi saham: `restoreStockTradeAction`) (Server Action; sesudah berhasil `refresh()` memuat ulang daftar), konflik
 * versi memuat ulang daftar lewat `router.refresh()`.
 */
export function TrashListReal({
  ruang,
  today,
  items,
  accounts,
  restoreLockedIds,
}: {
  ruang: Ruang;
  today: IsoDate;
  items: TrashVM[];
  accounts: AccountVM[];
  restoreLockedIds?: readonly string[] | undefined;
}) {
  const router = useRouter();
  return (
    <TrashList
      ruang={ruang}
      today={today}
      items={items}
      accounts={accounts}
      restoreLockedIds={restoreLockedIds}
      restore={async (req) => {
        // Transaksi saham dipulihkan sebagai satu paket lewat jalurnya sendiri (generik = stock_account_trade_only).
        const trade = items.find((i) => i.entry.id === req.entryId)?.entry.trade;
        if (trade === undefined) return restoreEntryAction(ruang, req);
        const r = await restoreStockTradeAction(ruang, {
          clientId: req.clientId,
          tradeId: trade.id,
          allowNegative: req.allowNegative,
        });
        return r.ok ? { ok: true, value: { version: 0 } } : r;
      }}
      onConflict={() => {
        router.refresh();
      }}
    />
  );
}
