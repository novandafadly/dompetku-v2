'use client';

import { useRef, useState } from 'react';
import { ArrowCounterClockwiseIcon } from '@/components/ui/icons/arrow-counter-clockwise';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { newClientId } from '@/features/ledger/client-id';
import type { LedgerErrorCode } from '@/features/ledger/types';
import { SAHAM_COPY as C } from './copy';
import type { StockSource } from './context';
import { stockFailedText } from './galat';
import type { StockTradeVM } from './types';

export interface VoidTradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticker: string;
  trade: StockTradeVM;
  /** Nama dompet saham ini (isi dialog saham berjalan). */
  accountName: string;
  source: StockSource;
  /** Sesudah berhasil: pemanggil menutup dialog dan menampilkan toast `Urungkan`. */
  onVoided: (trade: StockTradeVM) => void;
}

/** Isi dialog menurut sisi transaksi (S14-SH7), nama dompet dari data yang sudah dimuat. */
export function voidBody(p: { ticker: string; trade: StockTradeVM; accountName: string }): string {
  const { ticker, trade, accountName } = p;
  const other = trade.counterName ?? 'Dompet';
  const head =
    trade.side === 'buy'
      ? C.voidBuy(ticker, trade.shares, trade.occurredOn, other)
      : trade.side === 'sell'
        ? C.voidSell(ticker, trade.shares, trade.occurredOn, other)
        : C.voidOpen(ticker, trade.shares, trade.occurredOn, accountName);
  return `${head} ${C.voidRestorable}`;
}

/**
 * Dialog `Batalkan transaksi saham terakhir?` (S14-SH7): fokus awal `Kembali`, dialog menahan diri
 * sampai server menjawab. `trade_not_latest` mematikan tombol (ada transaksi lebih baru di tab lain);
 * `saldo_negatif` (dompet jadi minus) = `Tetap batalkan`.
 */
export function VoidTradeDialog({
  open,
  onOpenChange,
  ticker,
  trade,
  accountName,
  source,
  onVoided,
}: VoidTradeDialogProps) {
  const [clientId] = useState(newClientId);
  const [busy, setBusy] = useState(false);
  const [forced, setForced] = useState(false);
  const [failed, setFailed] = useState<LedgerErrorCode | null>(null);
  const running = useRef(false);

  async function confirm() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFailed(null);
    let res;
    try {
      res = await source.voidTrade({ clientId, tradeId: trade.id, allowNegative: forced });
    } catch {
      res = { ok: false as const, error: { code: 'network' as LedgerErrorCode } };
    } finally {
      running.current = false;
      setBusy(false);
    }
    if (res.ok) {
      onVoided(trade);
      return;
    }
    if (res.error.code === 'saldo_negatif') setForced(true);
    setFailed(res.error.code);
  }

  const blocked =
    failed === 'trade_not_latest' || failed === 'not_found' || failed === 'asset_negative';
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      icon={<ArrowCounterClockwiseIcon size={22} />}
      title={C.voidTitle}
      description={voidBody({ ticker, trade, accountName })}
      confirmLabel={forced ? C.voidAnyway : C.voidConfirm}
      cancelLabel={C.back}
      onConfirm={() => {
        void confirm();
      }}
      holdOpen
      busy={busy}
      confirmDisabled={blocked}
      alert={
        failed === null
          ? undefined
          : failed === 'saldo_negatif'
            ? 'Saldo dompet tidak cukup. Kalau tetap dibatalkan, saldonya jadi minus.'
            : failed === 'trade_not_latest'
              ? C.voidNotLatest(ticker)
              : failed === 'not_found'
                ? C.voidNotFound
                : stockFailedText(failed)
      }
    />
  );
}
