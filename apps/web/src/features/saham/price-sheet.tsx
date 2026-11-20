'use client';

import type { IsoDate, Rupiah } from '@dompetku/domain';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Alert, SelectField } from '@/components/ui/form-parts';
import { WarningIcon } from '@/components/ui/icons/warning';
import { MoneyInput } from '@/components/ui/money-input';
import { SaveButton } from '@/components/ui/save-button';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { newClientId } from '@/features/ledger/client-id';
import type { LedgerErrorCode } from '@/features/ledger/types';
import { SAHAM_COPY as C } from './copy';
import type { StockScope, StockSource } from './context';
import { FIELD_DATE, FIELD_PRICE, stockFailedText } from './galat';

const FORM_ID = 'isi-harga';

export interface PriceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: StockScope;
  source: StockSource;
  /** Kode terkunci (`Isi harga` di baris). */
  lockedTicker?: string | undefined;
  onSaved: (saved: { ticker: string; on: IsoDate }) => void;
  returnFocus?: HTMLElement | null | undefined;
}

/**
 * Sheet `Isi harga` (S14-SH5): harga penutupan manual per kode, berlaku di semua dompet saham
 * Pribadi (harga per ruang). Lonjakan > 35% ditolak server (`price_spike_unconfirmed`); pengguna
 * menandai `Ya, harga ini benar` lalu menyimpan lagi. Validasi nilai ada di SQL.
 */
export function PriceSheet(props: PriceSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <PriceSession key={session} {...props} />;
}

function PriceSession({
  open,
  onOpenChange,
  scope,
  source,
  lockedTicker,
  onSaved,
  returnFocus,
}: PriceSheetProps) {
  const { holdings, today } = scope;
  const [clientId] = useState(newClientId);
  const [ticker, setTicker] = useState(lockedTicker ?? holdings[0]?.ticker ?? '');
  const [close, setClose] = useState<Rupiah | null>(null);
  const [date, setDate] = useState<string>(today);
  const [spike, setSpike] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [priceError, setPriceError] = useState<string | undefined>();
  const [dateError, setDateError] = useState<string | undefined>();
  const [galat, setGalat] = useState<{ text: string; retry: boolean } | null>(null);
  const busy = useRef(false);
  const priceRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const spikeRef = useRef<HTMLDivElement>(null);

  // Kotak lonjakan muncul di bawah lipatan layar kecil: gulir ke sana supaya sakelarnya terlihat.
  useEffect(() => {
    if (spike) spikeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [spike]);

  const held = holdings.find((h) => h.ticker === ticker);

  async function save(ev?: SyntheticEvent) {
    ev?.preventDefault();
    if (busy.current) return;
    setGalat(null);
    if (close === null || close < 1 || close > 1_000_000_000) {
      setPriceError(FIELD_PRICE);
      priceRef.current?.focus();
      return;
    }
    if (date > today) {
      setDateError(FIELD_DATE);
      dateRef.current?.focus();
      return;
    }
    if (!/^[A-Z]{4}$/.test(ticker)) return;
    busy.current = true;
    setSaving(true);
    let res;
    try {
      res = await source.setPrice({
        clientId,
        ticker,
        close,
        ...(date === today ? {} : { on: date }),
        confirmSpike: confirmed,
      });
    } catch {
      res = { ok: false as const, error: { code: 'network' as LedgerErrorCode } };
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (res.ok) {
      onOpenChange(false);
      onSaved({ ticker, on: res.value.onDate });
      return;
    }
    const { code, field } = res.error;
    if (code === 'price_spike_unconfirmed') {
      setSpike(true);
      return;
    }
    if (code === 'invalid') {
      if (field === 'on') {
        setDateError(FIELD_DATE);
        dateRef.current?.focus();
      } else {
        setPriceError(FIELD_PRICE);
        priceRef.current?.focus();
      }
      return;
    }
    setGalat({
      text: stockFailedText(code),
      retry: code === 'network' || code === 'unknown',
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return;
        onOpenChange(next);
      }}
      title={C.priceTitle}
      titleContent={
        <>
          {C.setPrice}
          <SpaceTag space="pribadi" />
        </>
      }
      tint="pribadi"
      initialFocus={priceRef}
      returnFocus={returnFocus}
      footer={<SaveButton formId={FORM_ID} saving={saving} label={C.savePrice} />}
    >
      <form id={FORM_ID} noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
        {lockedTicker === undefined ? (
          <SelectField
            label={C.tickerField}
            value={ticker}
            onChange={(v) => {
              setTicker(v);
              setSpike(false);
              setConfirmed(false);
              setGalat(null);
            }}
            busy={saving}
          >
            {holdings.map((h) => (
              <option key={h.ticker} value={h.ticker} className="bg-surface text-text">
                {h.ticker}
              </option>
            ))}
          </SelectField>
        ) : (
          <p className="text-body font-bold text-text">{lockedTicker}</p>
        )}
        <p className="text-meta font-medium text-text-soft">
          {held?.close != null && held.closeOn !== null
            ? C.lastPrice(held.close, held.closeOn)
            : C.noPriceYet}
        </p>
        <div className="flex flex-col gap-1.5">
          <MoneyInput
            label={C.priceClose}
            value={close}
            onChange={(v) => {
              setClose(v);
              setPriceError(undefined);
              setSpike(false);
              setConfirmed(false);
              setGalat(null);
            }}
            readOnly={saving}
            inputRef={priceRef}
          />
          {priceError === undefined ? null : (
            <p role="alert" className="text-meta font-semibold text-danger">
              {priceError}
            </p>
          )}
        </div>
        <DateInput
          label={C.priceDateField}
          value={date}
          onChange={(v) => {
            setDate(v);
            setDateError(undefined);
            setSpike(false);
            setConfirmed(false);
          }}
          max={today}
          error={dateError}
          busy={saving}
          inputRef={dateRef}
        />
        <p className="text-caption font-medium text-text-muted">{C.priceScope(ticker)}</p>
        {spike ? (
          <div
            ref={spikeRef}
            role="alert"
            className="flex flex-col gap-2 rounded-lg bg-warning-tint p-3 text-warning"
          >
            <p className="flex items-start gap-2 text-label font-semibold">
              <WarningIcon size={18} weight="fill" className="mt-px shrink-0" />
              <span className="text-pretty">{C.spike(held?.closeOn ?? null)}</span>
            </p>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-label font-bold">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => {
                  setConfirmed(e.target.checked);
                }}
                className="size-5 shrink-0 accent-current"
              />
              {C.spikeConfirm}
            </label>
          </div>
        ) : null}
      </form>
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
