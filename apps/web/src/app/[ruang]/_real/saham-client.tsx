'use client';

import { useRouter } from 'next/navigation';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { focusRing } from '@/components/ui/styles';
import { newClientId } from '@/features/catat/client-id';
import { undoOrNotify } from '@/features/catat/saved-toast';
import type { ActionResult } from '@/features/ledger/types';
import { gainText, SAHAM_COPY as C } from '@/features/saham/copy';
import type { StockScope, StockSource } from '@/features/saham/context';
import type { StockTradeVM } from '@/features/saham/types';
import {
  buyStockAction,
  openStockHoldingAction,
  previewSellAction,
  restoreStockTradeAction,
  sellStockAction,
  setStockPriceAction,
  voidStockTradeAction,
} from '../_actions/saham';

/**
 * Pulau klien saham nyata (S14 Task 10; dimuat malas lewat `saham-islands`, satu chunk
 * `saham-client`). `StockButton` = tombol yang membuka sheet Beli / Jual / Isi harga / Saham yang sudah
 * dimiliki (sheet dimuat saat pertama dipakai atau saat tombol disorot); `VoidTradeButton` = tombol
 * `Batalkan` + dialog. Server Action `mutate` memanggil `refresh()`, jadi saldo dan daftar tampil
 * ulang tanpa navigasi. Galat jaringan = `network` (Coba lagi memakai `clientId` yang sama).
 */

const loadTrade = () => import('@/features/saham/trade-sheet');
const TradeSheet = lazy(() => loadTrade().then((m) => ({ default: m.TradeSheet })));
const loadPrice = () => import('@/features/saham/price-sheet');
const PriceSheet = lazy(() => loadPrice().then((m) => ({ default: m.PriceSheet })));
const loadOpen = () => import('@/features/saham/open-sheet');
const OpenSheet = lazy(() => loadOpen().then((m) => ({ default: m.OpenSheet })));
const loadVoid = () => import('@/features/saham/void-trade-dialog');
const VoidDialog = lazy(() => loadVoid().then((m) => ({ default: m.VoidTradeDialog })));

const PRELOAD = {
  buy: loadTrade,
  sell: loadTrade,
  price: loadPrice,
  open: loadOpen,
} as const;

async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch {
    return { ok: false, error: { code: 'network' } };
  }
}

function realSource(): StockSource {
  return {
    buy: (r) => guard(() => buyStockAction('pribadi', r)),
    sell: (r) => guard(() => sellStockAction('pribadi', r)),
    open: (r) => guard(() => openStockHoldingAction('pribadi', r)),
    preview: (r) => guard(() => previewSellAction('pribadi', r)),
    setPrice: (r) => guard(() => setStockPriceAction('pribadi', r)),
    voidTrade: (r) => guard(() => voidStockTradeAction('pribadi', r)),
    restoreTrade: (r) => guard(() => restoreStockTradeAction('pribadi', r)),
  };
}

export type StockKind = 'buy' | 'sell' | 'price' | 'open';

export interface StockButtonProps {
  kind: StockKind;
  scope: StockScope;
  label: string;
  /** Kode terkunci (tombol di baris); nama aksesibel memuat kode. */
  ticker?: string;
  ariaLabel?: string;
  variant?: 'button' | 'link';
  buttonVariant?: NonNullable<ButtonProps['variant']>;
  size?: NonNullable<ButtonProps['size']>;
}

export function StockButton({
  kind,
  scope,
  label,
  ticker,
  ariaLabel,
  variant = 'button',
  buttonVariant = 'secondary',
  size = 'sm',
}: StockButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  const mounted = useOpenedOnce(open);
  const source = useMemo(() => realSource(), []);
  const preload = () => {
    void PRELOAD[kind]();
  };
  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    setReturnFocus(e.currentTarget);
    setOpen(true);
  };
  return (
    <>
      {variant === 'link' ? (
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={onClick}
          onPointerEnter={preload}
          onFocus={preload}
          className={`inline-flex min-h-11 items-center rounded-md px-1 text-label font-bold text-accent-text hover-pointer:underline ${focusRing}`}
        >
          {label}
        </button>
      ) : (
        <Button
          variant={buttonVariant}
          size={size}
          aria-label={ariaLabel}
          onClick={onClick}
          onPointerEnter={preload}
          onFocus={preload}
        >
          {label}
        </Button>
      )}
      {mounted ? (
        <Suspense fallback={null}>
          {kind === 'buy' || kind === 'sell' ? (
            <TradeSheet
              open={open}
              onOpenChange={setOpen}
              mode={kind}
              scope={scope}
              source={source}
              lockedTicker={ticker}
              returnFocus={returnFocus}
              onStale={() => {
                router.refresh();
              }}
              onSaved={(s) => {
                // Jual: kalimat kedua = untung/rugi dari server, netral tanpa warna.
                toast({
                  message:
                    s.mode === 'buy'
                      ? C.bought(s.ticker, s.shares, s.amount, s.cashName)
                      : `${C.sold(s.ticker, s.shares, s.amount, s.cashName)}. ${gainText(s.realized ?? 0)}`,
                });
              }}
            />
          ) : kind === 'price' ? (
            <PriceSheet
              open={open}
              onOpenChange={setOpen}
              scope={scope}
              source={source}
              lockedTicker={ticker}
              returnFocus={returnFocus}
              onSaved={({ ticker: t, on }) => {
                toast({ message: C.priceSaved(t, on) });
              }}
            />
          ) : (
            <OpenSheet
              open={open}
              onOpenChange={setOpen}
              scope={scope}
              source={source}
              returnFocus={returnFocus}
              onSaved={({ ticker: t, shares }) => {
                toast({ message: C.opened(t, shares, scope.account.name) });
              }}
            />
          )}
        </Suspense>
      ) : null}
    </>
  );
}

export interface VoidTradeButtonProps {
  ticker: string;
  trade: StockTradeVM;
  accountName: string;
}

/** `Batalkan` di transaksi hidup terakhir satu kode (S14-SH7); `Urungkan` di toast = pulihkan. */
export function VoidTradeButton({ ticker, trade, accountName }: VoidTradeButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const mounted = useOpenedOnce(open);
  const source = useMemo(() => realSource(), []);
  const preload = () => {
    void loadVoid();
  };

  function voided() {
    setOpen(false);
    const clientId = newClientId();
    let running = false;
    toast({
      message: C.voided(ticker),
      action: {
        label: C.undo,
        onAction: () => {
          if (running) return;
          running = true;
          void undoOrNotify(
            async (id: string) => {
              const res = await source.restoreTrade({
                clientId,
                tradeId: id,
                allowNegative: false,
              });
              if (res.ok) router.refresh();
              return res.ok;
            },
            trade.id,
            toast,
            C.undoFailed,
          ).finally(() => {
            running = false;
          });
        },
      },
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Batalkan transaksi ${ticker} terakhir`}
        onClick={() => {
          setOpen(true);
        }}
        onPointerEnter={preload}
        onFocus={preload}
        className={`inline-flex min-h-11 items-center rounded-md px-2 text-label font-bold text-accent-text hover-pointer:underline ${focusRing}`}
      >
        {C.cancel}
      </button>
      {mounted ? (
        <Suspense fallback={null}>
          <VoidDialog
            open={open}
            onOpenChange={setOpen}
            ticker={ticker}
            trade={trade}
            accountName={accountName}
            source={source}
            onVoided={voided}
          />
        </Suspense>
      ) : null}
    </>
  );
}
