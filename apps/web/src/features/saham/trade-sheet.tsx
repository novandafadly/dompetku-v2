'use client';

import { formatRupiah, type Rupiah } from '@dompetku/domain';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { FieldHint } from '@/components/ui/field-messages';
import { Alert, SelectField } from '@/components/ui/form-parts';
import { MoneyInput } from '@/components/ui/money-input';
import { SaveButton } from '@/components/ui/save-button';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { TextField } from '@/components/ui/text-field';
import { WarningIcon } from '@/components/ui/icons/warning';
import { newClientId } from '@/features/ledger/client-id';
import type { LedgerErrorCode } from '@/features/ledger/types';
import { gainSpoken, gainText, SAHAM_COPY as C } from './copy';
import type { HoldingLite, StockScope, StockSource } from './context';
import { latestOf } from './context';
import { SharesField, sharesOf, type Unit } from './fields';
import {
  FIELD_AMOUNT,
  FIELD_CASH,
  FIELD_DATE,
  FIELD_DATE_EARLY,
  FIELD_PRICE,
  FIELD_SHARES,
  FIELD_SHARES_OVER,
  FIELD_TICKER,
  stockFailedText,
} from './galat';
import type { SellPreviewVM } from './types';

const FORM_ID = 'transaksi-saham';
const MAX_TOTAL = 10n ** 13n;
const PREVIEW_DELAY_MS = 400;

export type TradeMode = 'buy' | 'sell';

export interface TradeSaved {
  mode: TradeMode;
  ticker: string;
  shares: number;
  /** Total keluar (beli) / hasil bersih (jual), dari server. */
  amount: Rupiah;
  /** Untung/rugi terealisasi (jual), dari server. */
  realized: Rupiah | null;
  cashName: string;
}

export interface TradeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: TradeMode;
  scope: StockScope;
  source: StockSource;
  /** Kode terkunci (`Beli lagi`, `Jual` di baris). */
  lockedTicker?: string | undefined;
  onSaved: (saved: TradeSaved) => void;
  /** Kunci sama, isi beda: percobaan sebelumnya mungkin sudah tersimpan; pemanggil memuat ulang. */
  onStale?: () => void;
  returnFocus?: HTMLElement | null | undefined;
}

interface Errors {
  ticker?: string | undefined;
  shares?: string | undefined;
  price?: string | undefined;
  cash?: string | undefined;
  date?: string | undefined;
}

type PreviewState = { key: string; value: SellPreviewVM | 'failed' } | null;

/**
 * Sheet `Beli saham` / `Jual saham` (S14-SH3, SH4): satu komponen karena isiannya hampir sama
 * (kode, jumlah dalam lot atau lembar, harga, biaya, dompet, tanggal). Jual menambah pajak dan
 * pratinjau dari `api.preview_sell` (rumus di SQL; UI tidak menghitung biaya keluar atau untung/rugi).
 * Total keluar Beli = perkiraan dari isian pengguna sendiri, ditulis sebagai perkiraan. Satu
 * `clientId` per pembukaan sheet (klik ganda dan `Coba lagi` = replay).
 */
export function TradeSheet(props: TradeSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <TradeSession key={session} {...props} />;
}

const toRupiah = (n: bigint): Rupiah => Number(n);

function TradeSession({
  open,
  onOpenChange,
  mode,
  scope,
  source,
  lockedTicker,
  onSaved,
  onStale,
  returnFocus,
}: TradeSheetProps) {
  const sell = mode === 'sell';
  const { account, cash, holdings, today } = scope;
  const [clientId] = useState(newClientId);
  const [ticker, setTicker] = useState(lockedTicker ?? (sell ? (holdings[0]?.ticker ?? '') : ''));
  const [unit, setUnit] = useState<Unit>('lot');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState<Rupiah | null>(null);
  const [fee, setFee] = useState<Rupiah | null>(null);
  const [tax, setTax] = useState<Rupiah | null>(null);
  const [cashId, setCashId] = useState(cash[0]?.id ?? '');
  const [date, setDate] = useState<string>(today);
  const [saving, setSaving] = useState(false);
  const [forced, setForced] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [galat, setGalat] = useState<{ text: string; retry: boolean } | null>(null);
  const [pv, setPv] = useState<PreviewState>(null);
  const busy = useRef(false);
  const tickerRef = useRef<HTMLInputElement>(null);
  const tickerSelectRef = useRef<HTMLSelectElement>(null);
  const sharesRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const cashRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  const held: HoldingLite | undefined = holdings.find((h) => h.ticker === ticker);
  const shares = sharesOf(unit, amount);
  const chosen = cash.find((c) => c.id === cashId);
  const fromTrading = !sell && chosen?.pocket === 'trading';
  const minDate = latestOf(account.openedOn, chosen?.openedOn, scope.lastTradeOn[ticker]);

  // Perkiraan Total keluar (Beli): satu perkalian dari isian sendiri, BigInt agar tidak meluap.
  const estimate =
    !sell && shares !== null && price !== null && price > 0
      ? BigInt(shares) * BigInt(price) + BigInt(fee ?? 0)
      : null;
  const estimateOk = estimate !== null && estimate <= MAX_TOTAL;
  const negative = estimateOk && chosen !== undefined && toRupiah(estimate) > chosen.balance;
  const over = sell && shares !== null && held !== undefined && shares > held.shares;

  // Pratinjau jual: dipanggil sesudah kode, jumlah, dan harga sah; hasil basi (kunci beda) diabaikan.
  const previewInput =
    sell && held !== undefined && shares !== null && !over && price !== null && price > 0
      ? { accountId: account.id, ticker, shares, price, fee: fee ?? 0, tax: tax ?? 0 }
      : null;
  const previewKey =
    previewInput === null
      ? null
      : [ticker, previewInput.shares, previewInput.price, previewInput.fee, previewInput.tax].join(
          '|',
        );
  useEffect(() => {
    if (previewInput === null || previewKey === null) return;
    let cancelled = false;
    const t = setTimeout(() => {
      source.preview(previewInput).then(
        (res) => {
          if (!cancelled) setPv({ key: previewKey, value: res.ok ? res.value : 'failed' });
        },
        () => {
          if (!cancelled) setPv({ key: previewKey, value: 'failed' });
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // previewKey memuat semua masukan pratinjau; sisanya tetap selama sheet terbuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);
  const preview = previewKey !== null && pv?.key === previewKey ? pv.value : null;

  function clear(key?: keyof Errors) {
    if (key !== undefined) setErrors((e) => ({ ...e, [key]: undefined }));
    setGalat(null);
  }

  async function save(ev?: SyntheticEvent) {
    ev?.preventDefault();
    if (busy.current) return;
    const next: Errors = {};
    if (!/^[A-Z]{4}$/.test(ticker)) next.ticker = FIELD_TICKER;
    if (shares === null) next.shares = FIELD_SHARES;
    else if (over) next.shares = FIELD_SHARES_OVER;
    if (price === null || price < 1 || price > 1_000_000_000) next.price = FIELD_PRICE;
    else if (shares !== null && !sell && !estimateOk) next.shares = FIELD_AMOUNT;
    if (chosen === undefined) next.cash = FIELD_CASH;
    if (date > today) next.date = FIELD_DATE;
    setErrors(next);
    setGalat(null);
    if (next.ticker !== undefined) {
      (sell ? tickerSelectRef : tickerRef).current?.focus();
      return;
    }
    if (next.shares !== undefined) return sharesRef.current?.focus();
    if (next.price !== undefined) return priceRef.current?.focus();
    if (next.cash !== undefined) return cashRef.current?.focus();
    if (next.date !== undefined) return dateRef.current?.focus();
    if (shares === null || price === null || chosen === undefined) return;

    busy.current = true;
    setSaving(true);
    const base = {
      clientId,
      accountId: account.id,
      ticker,
      shares,
      price,
      fee: fee ?? 0,
      ...(date === today ? {} : { on: date }),
    };
    let res;
    try {
      res = sell
        ? await source.sell({ ...base, tax: tax ?? 0, toAccountId: chosen.id })
        : await source.buy({
            ...base,
            fromAccountId: chosen.id,
            allowNegative: negative || forced,
          });
    } catch {
      res = { ok: false as const, error: { code: 'network' as LedgerErrorCode } };
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (res.ok) {
      const value = res.value;
      onOpenChange(false);
      onSaved(
        'proceeds' in value
          ? {
              mode,
              ticker,
              shares,
              amount: value.proceeds,
              realized: value.realized,
              cashName: chosen.name,
            }
          : { mode, ticker, shares, amount: value.amount, realized: null, cashName: chosen.name },
      );
      return;
    }
    const { code, field } = res.error;
    switch (code) {
      case 'saldo_negatif':
        setForced(true);
        break;
      case 'insufficient_shares':
        setErrors({ shares: FIELD_SHARES_OVER });
        sharesRef.current?.focus();
        break;
      case 'before_latest_entry':
      case 'before_opening':
        setErrors({ date: FIELD_DATE_EARLY });
        dateRef.current?.focus();
        break;
      case 'account_archived':
      case 'asset_account_invalid':
        setErrors({ cash: stockFailedText(code) });
        cashRef.current?.focus();
        break;
      case 'idem_mismatch':
        onStale?.();
        setGalat({ text: stockFailedText(code), retry: false });
        break;
      case 'invalid': {
        const f = field ?? '';
        if (f.includes('ticker')) {
          setErrors({ ticker: FIELD_TICKER });
          (sell ? tickerSelectRef : tickerRef).current?.focus();
        } else if (f.includes('shares') || f.includes('amount')) {
          setErrors({ shares: f.includes('amount') ? FIELD_AMOUNT : FIELD_SHARES });
          sharesRef.current?.focus();
        } else if (f.includes('price')) {
          setErrors({ price: FIELD_PRICE });
          priceRef.current?.focus();
        } else if (f === 'on') {
          setErrors({ date: FIELD_DATE });
          dateRef.current?.focus();
        } else {
          setGalat({ text: stockFailedText('unknown'), retry: true });
        }
        break;
      }
      case 'network':
      case 'unknown':
        setGalat({ text: stockFailedText(code), retry: true });
        break;
      default:
        setGalat({ text: stockFailedText(code), retry: false });
    }
  }

  const titleText = sell ? C.sellTitle : C.buyTitle;
  const noCash = cash.length === 0;
  const saveLabel = sell ? C.saveSell : negative || forced ? C.saveBuyAnyway : C.saveBuy;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return;
        onOpenChange(next);
      }}
      title={titleText}
      titleContent={
        <>
          {sell ? C.sell : C.buy}
          <SpaceTag space="pribadi" />
        </>
      }
      tint="pribadi"
      initialFocus={lockedTicker !== undefined || sell ? sharesRef : tickerRef}
      returnFocus={returnFocus}
      footer={
        noCash ? undefined : <SaveButton formId={FORM_ID} saving={saving} label={saveLabel} />
      }
    >
      {noCash ? (
        <p className="text-body font-semibold text-text text-pretty">{C.noCash}</p>
      ) : (
        <form
          id={FORM_ID}
          noValidate
          onSubmit={(e) => void save(e)}
          className="flex flex-col gap-3"
        >
          {sell && lockedTicker === undefined ? (
            <div className="flex flex-col gap-1">
              <SelectField
                label={C.tickerField}
                value={ticker}
                onChange={(v) => {
                  setTicker(v);
                  setForced(false);
                  clear('ticker');
                }}
                error={errors.ticker}
                selectRef={tickerSelectRef}
                busy={saving}
              >
                {holdings.map((h) => (
                  <option key={h.ticker} value={h.ticker} className="bg-surface text-text">
                    {h.ticker}
                  </option>
                ))}
              </SelectField>
              {held === undefined ? null : (
                <p className="text-meta font-medium text-text-soft">{C.owned(held.shares)}</p>
              )}
            </div>
          ) : lockedTicker !== undefined ? (
            <div className="flex flex-col gap-1">
              <TextField label={C.tickerField} value={ticker} onChange={() => undefined} readOnly />
              {sell && held !== undefined ? (
                <p className="text-meta font-medium text-text-soft">{C.owned(held.shares)}</p>
              ) : null}
            </div>
          ) : (
            <TextField
              label={C.tickerField}
              value={ticker}
              onChange={(v) => {
                setTicker(
                  v
                    .toUpperCase()
                    .replace(/[^A-Z]/g, '')
                    .slice(0, 4),
                );
                clear('ticker');
              }}
              error={errors.ticker}
              hint={C.tickerHint}
              maxLength={4}
              autoComplete="off"
              readOnly={saving}
              inputRef={tickerRef}
            />
          )}
          <SharesField
            unit={unit}
            onUnit={(u) => {
              setUnit(u);
              clear('shares');
            }}
            text={amount}
            onText={(t) => {
              setAmount(t);
              setForced(false);
              clear('shares');
            }}
            error={errors.shares}
            readOnly={saving}
            inputRef={sharesRef}
            extra={
              sell && held !== undefined ? (
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => {
                    setUnit('lembar');
                    setAmount(String(held.shares));
                    clear('shares');
                  }}
                >
                  {C.sellAll}
                </Button>
              ) : undefined
            }
          />
          <div className="flex flex-col gap-1.5">
            <MoneyInput
              label={C.priceField}
              value={price}
              onChange={(v) => {
                setPrice(v);
                setForced(false);
                clear('price');
              }}
              readOnly={saving}
              inputRef={priceRef}
            />
            {errors.price === undefined ? null : (
              <p role="alert" className="text-meta font-semibold text-danger">
                {errors.price}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <MoneyInput
              label={C.feeField}
              optional
              value={fee}
              onChange={(v) => {
                setFee(v);
                setForced(false);
              }}
              readOnly={saving}
            />
            {sell ? null : <FieldHint id="saham-fee-hint">{C.feeHint}</FieldHint>}
          </div>
          {sell ? (
            <div className="flex flex-col gap-1.5">
              <MoneyInput
                label={C.taxField}
                optional
                value={tax}
                onChange={setTax}
                readOnly={saving}
              />
              <FieldHint id="saham-tax-hint">{C.taxHint}</FieldHint>
            </div>
          ) : null}
          {sell ? (
            <SellPreview preview={preview} loading={previewInput !== null && preview === null} />
          ) : (
            <div role="status" aria-live="polite" className="flex flex-col gap-0.5">
              {estimateOk ? (
                <>
                  <p className="num text-body font-bold text-text">{C.total(toRupiah(estimate))}</p>
                  <p className="text-caption font-medium text-text-muted">{C.totalNote}</p>
                </>
              ) : null}
            </div>
          )}
          <SelectField
            label={sell ? C.toField : C.fromField}
            value={cashId}
            onChange={(v) => {
              setCashId(v);
              setForced(false);
              clear('cash');
            }}
            error={errors.cash}
            selectRef={cashRef}
            busy={saving}
          >
            {cash.map((c) => (
              <option key={c.id} value={c.id} className="bg-surface text-text">
                {c.name}
              </option>
            ))}
          </SelectField>
          {fromTrading ? (
            <p className="text-caption font-medium text-text-muted">{C.tradingNote(chosen.name)}</p>
          ) : null}
          {!sell && (negative || forced) && chosen !== undefined ? (
            <p
              role="status"
              className="flex items-start gap-2 rounded-lg bg-warning-tint p-3 text-label font-semibold text-warning"
            >
              <WarningIcon size={18} weight="fill" className="mt-px shrink-0" />
              <span className="text-pretty">
                {`Saldo ${chosen.name} tidak cukup. Kalau dibeli, saldonya jadi minus.`}
              </span>
            </p>
          ) : null}
          <DateInput
            label={C.dateField}
            value={date}
            onChange={(v) => {
              setDate(v);
              clear('date');
            }}
            min={minDate}
            max={today}
            error={errors.date}
            busy={saving}
            inputRef={dateRef}
          />
        </form>
      )}
      {galat === null ? null : (
        <Alert
          action={
            galat.retry ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void save();
                }}
              >
                Coba lagi
              </Button>
            ) : undefined
          }
        >
          {galat.text}
        </Alert>
      )}
      <div aria-hidden="true" className="pb-3" />
    </Sheet>
  );
}

/** Pratinjau jual dari server: hasil bersih, biaya beli yang keluar, untung/rugi (netral, dengan kata). */
function SellPreview({
  preview,
  loading,
}: {
  preview: SellPreviewVM | 'failed' | null;
  loading: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={loading || undefined}
      className="flex min-h-11 flex-col justify-center gap-1 rounded-xl bg-surface-2 p-3"
    >
      {preview === 'failed' ? (
        <p className="text-meta font-medium text-text-soft">{C.previewFailed}</p>
      ) : preview !== null ? (
        <dl className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-meta font-semibold text-text-soft">{C.netLabel}</dt>
            <dd className="num text-body font-bold text-text">{formatRupiah(preview.proceeds)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-meta font-semibold text-text-soft">{C.costOutLabel}</dt>
            <dd className="num text-label font-semibold text-text">
              {formatRupiah(preview.costRemoved)}
            </dd>
          </div>
          <div className="flex items-baseline justify-end">
            <dd className="num text-body font-bold text-text">
              <span aria-hidden="true">{gainText(preview.realized)}</span>
              <span className="sr-only">{gainSpoken(preview.realized)}</span>
            </dd>
          </div>
        </dl>
      ) : loading ? (
        <p className="text-meta font-medium text-text-soft">{C.previewLoading}</p>
      ) : null}
    </div>
  );
}
