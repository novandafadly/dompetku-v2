'use client';

import type { Rupiah } from '@dompetku/domain';
import { useRef, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Alert } from '@/components/ui/form-parts';
import { MoneyInput } from '@/components/ui/money-input';
import { SaveButton } from '@/components/ui/save-button';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { TextField } from '@/components/ui/text-field';
import { newClientId } from '@/features/ledger/client-id';
import type { LedgerErrorCode } from '@/features/ledger/types';
import { SAHAM_COPY as C } from './copy';
import type { StockScope, StockSource } from './context';
import { latestOf } from './context';
import { SharesField, sharesOf, type Unit } from './fields';
import {
  FIELD_AMOUNT,
  FIELD_DATE,
  FIELD_DATE_EARLY,
  FIELD_PRICE,
  FIELD_SHARES,
  FIELD_TICKER,
  stockFailedText,
} from './galat';

const FORM_ID = 'saham-dimiliki';

export interface OpenSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: StockScope;
  source: StockSource;
  onSaved: (saved: { ticker: string; shares: number }) => void;
  returnFocus?: HTMLElement | null | undefined;
}

interface Errors {
  ticker?: string | undefined;
  shares?: string | undefined;
  price?: string | undefined;
  date?: string | undefined;
}

/**
 * Sheet `Saham yang sudah dimiliki` (S14-SH6): saham yang dibeli sebelum memakai DompetKu, tanpa efek
 * kas (pola utang berjalan). `Sejak` paling awal = tanggal dompet saham dibuka atau transaksi terakhir
 * kode itu (DB menolak tanggal lebih awal: `before_opening`/`before_latest_entry`), dan itu juga isian
 * bawaannya.
 */
export function OpenSheet(props: OpenSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <OpenSession key={session} {...props} />;
}

function OpenSession({ open, onOpenChange, scope, source, onSaved, returnFocus }: OpenSheetProps) {
  const { account, holdings, today } = scope;
  const [clientId] = useState(newClientId);
  const [ticker, setTicker] = useState('');
  const [unit, setUnit] = useState<Unit>('lembar');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState<Rupiah | null>(null);
  const [since, setSince] = useState<string>(latestOf(account.openedOn));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [galat, setGalat] = useState<{ text: string; retry: boolean } | null>(null);
  const busy = useRef(false);
  const tickerRef = useRef<HTMLInputElement>(null);
  const sharesRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  const shares = sharesOf(unit, amount);
  const minDate = latestOf(account.openedOn, scope.lastTradeOn[ticker]);
  const exists = holdings.some((h) => h.ticker === ticker);

  function clear(key: keyof Errors) {
    setErrors((e) => ({ ...e, [key]: undefined }));
    setGalat(null);
  }

  async function save(ev?: SyntheticEvent) {
    ev?.preventDefault();
    if (busy.current) return;
    const next: Errors = {};
    if (!/^[A-Z]{4}$/.test(ticker)) next.ticker = FIELD_TICKER;
    if (shares === null) next.shares = FIELD_SHARES;
    if (price === null || price < 1 || price > 1_000_000_000) next.price = FIELD_PRICE;
    if (since > today) next.date = FIELD_DATE;
    else if (since < minDate) next.date = FIELD_DATE_EARLY;
    setErrors(next);
    setGalat(null);
    if (next.ticker !== undefined) return tickerRef.current?.focus();
    if (next.shares !== undefined) return sharesRef.current?.focus();
    if (next.price !== undefined) return priceRef.current?.focus();
    if (next.date !== undefined) return dateRef.current?.focus();
    if (shares === null || price === null) return;

    busy.current = true;
    setSaving(true);
    let res;
    try {
      res = await source.open({
        clientId,
        accountId: account.id,
        ticker,
        shares,
        price,
        ...(since === today ? {} : { on: since }),
      });
    } catch {
      res = { ok: false as const, error: { code: 'network' as LedgerErrorCode } };
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (res.ok) {
      onOpenChange(false);
      onSaved({ ticker, shares });
      return;
    }
    const { code, field } = res.error;
    if (code === 'before_latest_entry' || code === 'before_opening') {
      setErrors({ date: FIELD_DATE_EARLY });
      dateRef.current?.focus();
    } else if (code === 'invalid') {
      const f = field ?? '';
      if (f.includes('ticker')) setErrors({ ticker: FIELD_TICKER });
      else if (f.includes('amount')) setErrors({ shares: FIELD_AMOUNT });
      else if (f.includes('shares')) setErrors({ shares: FIELD_SHARES });
      else if (f.includes('price')) setErrors({ price: FIELD_PRICE });
      else if (f === 'on') setErrors({ date: FIELD_DATE });
      else setGalat({ text: stockFailedText('unknown'), retry: true });
    } else {
      setGalat({ text: stockFailedText(code), retry: code === 'network' || code === 'unknown' });
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return;
        onOpenChange(next);
      }}
      title={C.openTitle}
      titleContent={
        <>
          <span className="min-w-0 break-words">{C.open}</span>
          <SpaceTag space="pribadi" />
        </>
      }
      tint="pribadi"
      initialFocus={tickerRef}
      returnFocus={returnFocus}
      footer={<SaveButton formId={FORM_ID} saving={saving} label={C.saveOpen} />}
    >
      <form id={FORM_ID} noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
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
          hint={exists ? C.openAdds(ticker) : C.tickerHint}
          maxLength={4}
          autoComplete="off"
          readOnly={saving}
          inputRef={tickerRef}
        />
        <SharesField
          unit={unit}
          onUnit={(u) => {
            setUnit(u);
            clear('shares');
          }}
          text={amount}
          onText={(t) => {
            setAmount(t);
            clear('shares');
          }}
          error={errors.shares}
          readOnly={saving}
          inputRef={sharesRef}
        />
        <div className="flex flex-col gap-1.5">
          <MoneyInput
            label={C.avgField}
            value={price}
            onChange={(v) => {
              setPrice(v);
              clear('price');
            }}
            readOnly={saving}
            inputRef={priceRef}
          />
          {errors.price === undefined ? (
            <p className="text-caption font-medium text-text-muted">{C.avgHint}</p>
          ) : (
            <p role="alert" className="text-meta font-semibold text-danger">
              {errors.price}
            </p>
          )}
        </div>
        <DateInput
          label={C.sinceField}
          value={since}
          onChange={(v) => {
            setSince(v);
            clear('date');
          }}
          min={minDate}
          max={today}
          error={errors.date}
          busy={saving}
          inputRef={dateRef}
        />
        <p className="text-meta font-medium text-text-soft">{C.openNote}</p>
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
