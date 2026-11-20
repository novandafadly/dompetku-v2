import { shortDateLabel, type IsoDate, type Rupiah } from '@dompetku/domain';
import type { ReactNode } from 'react';
import { CaretDownIcon } from '@/components/ui/icons/caret-down';
import { ChartLineUpIcon } from '@/components/ui/icons/chart-line-up';
import { ClockIcon } from '@/components/ui/icons/clock';
import { InfoIcon } from '@/components/ui/icons/info';
import { WarningIcon } from '@/components/ui/icons/warning';
import { ListCard } from '@/components/ui/list-card';
import { MoneyText } from '@/components/ui/money-text';
import { EmptyState } from '@/components/ui/state';
import { CardError } from '@/features/bersama/card-error';
import type { AccountVM, Ruang } from '@/features/ledger/types';
import { cashOptions, holdingLite, lastTradeOnOf, type StockScope } from '@/features/saham/context';
import {
  gainSpoken,
  gainText,
  priceStateOf,
  SAHAM_COPY as C,
  sharesLabel,
} from '@/features/saham/copy';
import type { StockHoldingVM, StockOverviewVM } from '@/features/saham/types';
import { StockButtonIsland, VoidTradeIsland } from './saham-islands';

/**
 * Detail dompet saham mode nyata (S14-SH1, SH2; Server Component, HTML murni; tombol dan sheet =
 * pulau malas `saham-client`). Semua angka (nilai pasar, biaya beli, harga rata-rata, untung/rugi,
 * keadaan harga) dari `api.stock_overview`; di sini hanya memilih kalimat dan memformat. Untung/rugi
 * selalu tanda + kata dan netral (bukan pemasukan/pengeluaran, tanpa hijau/merah).
 */

/** Data pulau: dompet saham ini, dompet kas pilihan, kode yang dipegang dan batas tanggalnya. */
export function stockScope(p: {
  ruang: Ruang;
  today: IsoDate;
  account: { id: string; name: string; openedOn: IsoDate };
  accounts: readonly AccountVM[];
  overview: StockOverviewVM;
}): StockScope {
  return {
    ruang: p.ruang,
    today: p.today,
    account: p.account,
    cash: cashOptions(p.accounts),
    holdings: p.overview.holdings.filter((h) => h.shares > 0).map(holdingLite),
    lastTradeOn: lastTradeOnOf(p.overview.holdings),
  };
}

/** Untung/rugi: kata + tanda, pembaca layar mendengar `ditambah`/`dikurangi` (bukan simbol). */
function Gain({ value, className = '' }: { value: Rupiah; className?: string }) {
  return (
    <span className={`num ${className}`}>
      <span aria-hidden="true">{gainText(value)}</span>
      <span className="sr-only">{gainSpoken(value)}</span>
    </span>
  );
}

/** Tanggal harga paling lama di antara kode berlembar (label harga kartu saldo). */
function oldestClose(holdings: readonly StockHoldingVM[]): IsoDate | null {
  let out: IsoDate | null = null;
  for (const h of holdings) {
    if (h.shares > 0 && h.closeOn !== null && (out === null || h.closeOn < out)) out = h.closeOn;
  }
  return out;
}

/**
 * Isi kartu saldo (`balanceNode` kepala dompet): nilai pasar besar, lalu biaya beli, untung/rugi
 * belum dan sudah terealisasi, label harga, dan penanda keadaan harga. Tanpa saham: `Belum ada saham`.
 */
export function StockBalance({ overview }: { overview: StockOverviewVM }) {
  const { total, holdings } = overview;
  const owned = holdings.filter((h) => h.shares > 0);
  if (owned.length === 0) {
    return <span className="text-body font-semibold text-text-soft">{C.noStock}</span>;
  }
  const oldest = oldestClose(holdings);
  return (
    <span className="flex flex-col gap-1">
      <MoneyText value={total.marketValue} size="amount-sm" />
      <span className="flex flex-col gap-0.5 text-meta font-medium text-text-soft">
        <span>{C.cost(total.costTotal)}</span>
        {total.unrealized === null ? null : <span>{C.unrealizedGain(total.unrealized)}</span>}
        {total.realized === 0 ? null : <span>{C.realizedGain(total.realized)}</span>}
      </span>
      <span className="flex flex-col gap-0.5 text-caption font-medium text-text-muted">
        {total.missingPriceCount > 0 ? (
          <span className="flex items-start gap-1.5">
            <InfoIcon size={14} className="mt-px shrink-0" />
            {C.someMissing}
          </span>
        ) : oldest === null ? null : (
          <span className="flex items-center gap-1.5">
            <ClockIcon size={14} className="shrink-0" />
            {C.priceDate(oldest)}
          </span>
        )}
        {total.heldPending ? (
          <span className="flex items-center gap-1.5 font-semibold text-warning">
            <WarningIcon size={14} weight="fill" className="shrink-0" />
            {C.someHeld}
          </span>
        ) : total.stale ? (
          <span className="flex items-center gap-1.5 font-semibold text-text-soft">
            <ClockIcon size={14} className="shrink-0" />
            {C.someStale}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** Aksi kepala dompet (SH1): Beli saham, Jual saham, Isi harga, Saham yang sudah dimiliki. */
export function StockActions({ scope }: { scope: StockScope }) {
  const hasShares = scope.holdings.length > 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StockButtonIsland
          kind="buy"
          scope={scope}
          label={C.buy}
          buttonVariant="primary"
          size="md"
        />
        {hasShares ? (
          <>
            <StockButtonIsland kind="sell" scope={scope} label={C.sell} />
            <StockButtonIsland kind="price" scope={scope} label={C.setPrice} />
          </>
        ) : null}
        <StockButtonIsland kind="open" scope={scope} label={C.open} variant="link" />
      </div>
      <p className="text-caption font-medium text-text-muted">{C.brokerNote}</p>
    </div>
  );
}

function DlRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-text-soft">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function PriceMarker({ h }: { h: StockHoldingVM }) {
  const state = priceStateOf(h);
  if (state === 'held') {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-warning">
        <WarningIcon size={14} weight="fill" className="shrink-0" />
        {C.held}
      </span>
    );
  }
  if (state === 'stale') {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-text-soft">
        <ClockIcon size={14} className="shrink-0" />
        {C.stale}
      </span>
    );
  }
  if (state === 'none') {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-text-soft">
        <InfoIcon size={14} className="shrink-0" />
        {C.noPrice}
      </span>
    );
  }
  return null;
}

function HoldingRow({
  h,
  scope,
  accountName,
}: {
  h: StockHoldingVM;
  scope: StockScope;
  accountName: string;
}) {
  const one: StockScope = {
    ...scope,
    holdings: scope.holdings.filter((x) => x.ticker === h.ticker),
    lastTradeOn: h.trades[0] === undefined ? {} : { [h.ticker]: h.trades[0].occurredOn },
  };
  const state = priceStateOf(h);
  return (
    <li className="border-b border-hairline last:border-b-0">
      <details className="group" data-testid={`holding-${h.ticker}`}>
        <summary
          aria-label={`${h.ticker}, ${sharesLabel(h.shares)}`}
          className="flex min-h-18 cursor-pointer list-none flex-col justify-center gap-1 py-3 outline-none focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden"
        >
          <span className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body font-bold text-text">{h.ticker}</span>
              <span className="text-meta font-medium text-text-muted">{sharesLabel(h.shares)}</span>
            </span>
            <span className="flex flex-col items-end gap-0.5 text-right">
              <MoneyText value={h.marketValue} size="list" />
              {state === 'none' ? (
                <span className="text-meta font-medium text-text-soft">{C.asCost}</span>
              ) : h.unrealized === null ? null : (
                <Gain value={h.unrealized} className="text-meta font-semibold text-text-soft" />
              )}
            </span>
            <CaretDownIcon
              size={16}
              weight="bold"
              aria-hidden="true"
              className="mt-1 shrink-0 text-text-soft transition-transform group-open:rotate-180"
            />
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta font-medium text-text-soft">
            {h.avgCost === null ? null : <span>{C.avg(h.avgCost)}</span>}
            {h.close !== null && h.closeOn !== null ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{C.priceMeta(h.close, h.closeOn)}</span>
              </>
            ) : null}
            {state === 'fresh' ? null : <PriceMarker h={h} />}
          </span>
        </summary>
        <div className="flex flex-col gap-3 pb-4">
          <dl className="flex flex-col gap-1 text-meta font-medium">
            <DlRow label={C.dlCost}>
              <MoneyText value={h.costTotal} size="row" />
            </DlRow>
            {h.avgCost === null ? null : (
              <DlRow label={C.dlAvg}>
                <MoneyText value={h.avgCost} size="row" />
              </DlRow>
            )}
            {h.close === null || h.closeOn === null ? null : (
              <DlRow label={C.dlLast}>
                <MoneyText value={h.close} size="row" />
                <span className="text-text-muted"> · {shortDateLabel(h.closeOn)}</span>
              </DlRow>
            )}
            <DlRow label={C.dlMarket}>
              <MoneyText value={h.marketValue} size="row" />
            </DlRow>
            {h.unrealized === null ? null : (
              <DlRow label={C.dlUnrealized}>
                <Gain value={h.unrealized} />
              </DlRow>
            )}
            {h.realized === 0 ? null : (
              <DlRow label={C.dlRealized}>
                <Gain value={h.realized} />
              </DlRow>
            )}
          </dl>
          {state === 'stale' ? (
            <p className="text-meta font-medium text-text-soft">{C.staleHint}</p>
          ) : null}
          {state === 'held' && h.heldOn !== null ? (
            <p className="text-meta font-medium text-warning">{C.heldHint(h.heldOn, h.closeOn)}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <StockButtonIsland
              kind="buy"
              scope={one}
              label={C.buyMore}
              ticker={h.ticker}
              ariaLabel={`${C.buyMore} ${h.ticker}`}
            />
            <StockButtonIsland
              kind="sell"
              scope={one}
              label={C.sellOne}
              ticker={h.ticker}
              ariaLabel={`${C.sellOne} ${h.ticker}`}
            />
            <StockButtonIsland
              kind="price"
              scope={one}
              label={C.setPrice}
              ticker={h.ticker}
              ariaLabel={`${C.setPrice} ${h.ticker}`}
            />
          </div>
          {h.trades.length === 0 ? null : (
            <div className="flex flex-col gap-1">
              <h3 className="text-meta font-bold text-text-soft">{C.tradesOf(h.ticker)}</h3>
              <ul className="flex flex-col">
                {h.trades.map((t) => (
                  <li
                    key={t.id}
                    className="flex min-h-11 items-center justify-between gap-2 text-meta font-medium text-text"
                  >
                    <span className="min-w-0">
                      <span className="text-text-muted">{shortDateLabel(t.occurredOn)} · </span>
                      {C.tradeLine(t.side, t.shares, t.price)}
                    </span>
                    {t.id === h.lastTradeId ? (
                      <VoidTradeIsland ticker={h.ticker} trade={t} accountName={accountName} />
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="text-caption font-medium text-text-muted">{C.cancelNote}</p>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

/** Galat muat posisi: kartu galat dengan `Coba lagi` (kartu saldo dari daftar Dompet tetap). */
export function StockLoadFailed({ retryHref }: { retryHref: string }) {
  return (
    <section
      aria-label={C.listTitle}
      id="saham"
      className="rounded-xl border border-hairline bg-surface px-4 pt-3"
    >
      <CardError message={C.loadFailed} retryHref={retryHref} />
    </section>
  );
}

/**
 * Daftar `Saham` (SH1): satu baris per kode berlembar (nilai pasar terbesar dulu, urutan SQL), di
 * bawahnya `Sudah dijual habis`. Tanpa saham sama sekali: keadaan kosong dengan ajakan.
 */
export function StockSection({
  scope,
  overview,
}: {
  scope: StockScope;
  overview: StockOverviewVM;
}) {
  const owned = overview.holdings.filter((h) => h.shares > 0);
  const soldOut = overview.holdings.filter((h) => h.shares === 0);
  if (owned.length === 0 && soldOut.length === 0) {
    return (
      <div id="saham">
        <EmptyState
          icon={<ChartLineUpIcon size={26} />}
          title={C.emptyTitle(scope.account.name)}
          description={C.emptyBody}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <StockButtonIsland
                kind="buy"
                scope={scope}
                label={C.buy}
                buttonVariant="primary"
                size="md"
              />
              <StockButtonIsland kind="open" scope={scope} label={C.open} variant="link" />
            </div>
          }
        />
      </div>
    );
  }
  return (
    <div id="saham" className="flex flex-col gap-3 scroll-mt-4">
      {owned.length === 0 ? null : (
        <ListCard title={C.listTitle}>
          <ul>
            {owned.map((h) => (
              <HoldingRow key={h.holdingId} h={h} scope={scope} accountName={scope.account.name} />
            ))}
          </ul>
        </ListCard>
      )}
      {soldOut.length === 0 ? null : (
        <details className="rounded-xl border border-hairline bg-surface px-4">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-label font-bold text-text-soft [&::-webkit-details-marker]:hidden">
            {C.soldOut(soldOut.length)}
            <CaretDownIcon size={16} weight="bold" aria-hidden="true" className="shrink-0" />
          </summary>
          <ul className="pb-3">
            {soldOut.map((h) => (
              <li
                key={h.holdingId}
                className="flex min-h-11 items-center justify-between gap-3 border-t border-hairline text-meta font-medium"
              >
                <span className="text-body font-bold text-text">{h.ticker}</span>
                <Gain value={h.realized} className="text-text-soft" />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
