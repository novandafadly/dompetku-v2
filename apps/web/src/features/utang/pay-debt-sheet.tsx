'use client';

import { addDays, dayLabel, formatRupiah, type IsoDate, type Rupiah } from '@dompetku/domain';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { FieldError, FieldHint } from '@/components/ui/field-messages';
import { MoneyInput } from '@/components/ui/money-input';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { newClientId } from '@/features/ledger/client-id';
import type { AccountVM, LedgerErrorCode } from '@/features/ledger/types';
import { Alert, payableAccounts, SelectField } from '@/features/rencana/form-parts';
import { UTANG_COPY as C, paySheetTitle, saldoWarning } from './copy';
import { utangFailedText } from './galat';
import { NoAccountBlock, SaveButton, WarningBox } from './fields';
import { KolomKas } from './kolom-kas';
import {
  payFooterLabel,
  payPreview,
  quickOptions,
  selectedQuick,
  walletChangeNote,
} from './present';
import type { PayTarget } from './types';

const FORM_ID = 'bayar-utang';
const MAX_AMOUNT = 10 ** 13;
/** Tanggal bayar: hari ini sampai 13 hari lalu (pola Bayar tagihan), tidak sebelum utang mulai. */
const DATE_CHOICES = 14;

export interface PaySubmit {
  clientId: string;
  debtId: string;
  accountId: string;
  amount: Rupiah;
  occurredOn: IsoDate;
  allowNegative: boolean;
}
export type PayResult =
  | { ok: true; entryId: string; version: number; remaining: Rupiah }
  | { ok: false; code: LedgerErrorCode; field?: string };

export interface PaidInfo {
  debtId: string;
  name: string;
  direction: PayTarget['direction'];
  amount: Rupiah;
  accountName: string;
  entryId: string;
  version: number;
  remaining: Rupiah;
}

export interface PayDebtSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Utang yang dibayar, SELALU data terbaru dari halaman (sisa berubah sesudah muat ulang). */
  target: PayTarget | null;
  accounts: readonly AccountVM[];
  today: IsoDate;
  onPay: (input: PaySubmit) => Promise<PayResult>;
  onPaid: (info: PaidInfo) => void;
  /** Muat ulang data halaman (sheet tetap terbuka): sisa terbaru masuk lewat `target`. */
  onRefresh: () => void;
}

type Galat = 'network' | 'server' | 'idem' | 'gone' | 'invalid';

/**
 * Sheet `Bayar utang ke {nama}` / `Terima dari {nama}` (S11-BY1): satu cicilan secepat mungkin,
 * sisa selalu terlihat, bayar lebih tidak bisa lolos (K7: galat kolom + `Bayar sisa Rp …` yang
 * MENGISI kolom, tidak menyimpan). Satu `clientId` per pembukaan (klik ganda = satu entri, C6).
 * Tanpa dialog konfirmasi (jalur cepat; efeknya terlihat di `KolomKas` dan bisa diurungkan).
 */
export function PayDebtSheet(props: PayDebtSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <PaySession key={session} {...props} />;
}

function PaySession({
  open,
  onOpenChange,
  target,
  accounts,
  today,
  onPay,
  onPaid,
  onRefresh,
}: PayDebtSheetProps) {
  const payable = payableAccounts(accounts);
  const [clientId] = useState(newClientId);
  const [amount, setAmount] = useState<Rupiah | null>(null);
  const [accountId, setAccountId] = useState(
    payable.find((a) => a.id === target?.accountId)?.id ??
      (payable.find((a) => a.pocket === 'operasional') ?? payable[0])?.id ??
      '',
  );
  const [date, setDate] = useState<string>(today);
  const [saving, setSaving] = useState(false);
  const [forced, setForced] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverExceeds, setServerExceeds] = useState(false);
  const [errors, setErrors] = useState<{
    account?: string | undefined;
    date?: string | undefined;
    amount?: string | undefined;
  }>({});
  const [galat, setGalat] = useState<Galat | null>(null);
  const busy = useRef(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const accountRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLSelectElement>(null);
  const errorId = useId();
  if (target === null) return null;

  const lent = target.direction === 'lent';
  const account = payable.find((a) => a.id === accountId);
  const options = quickOptions(target.quick);
  const chosen = selectedQuick(options, amount);
  const gone = target.remaining === 0 || galat === 'gone';
  const exceeds = (amount !== null && amount > target.remaining) || serverExceeds;
  const valid = amount !== null && amount > 0 && amount <= target.remaining;
  const preview =
    valid && account !== undefined
      ? payPreview(target.direction, amount, target.remaining, account.balance)
      : null;
  const negative = preview !== null && !lent && preview.walletAfter < 0;
  const oldest = target.openedOn;
  const dates = Array.from({ length: DATE_CHOICES }, (_, i) => addDays(today, -i)).filter(
    (d) => d >= oldest,
  );
  if (dates.length === 0) dates.push(today);
  const footerLabel =
    negative || forced ? C.payAnyway : payFooterLabel(target.direction, amount, target.remaining);
  const amountError =
    errors.amount ??
    (exceeds ? C.errExceeds(target.direction) : undefined) ??
    (attempted && (amount === null || amount <= 0) ? C.errAmount : undefined);

  async function pay() {
    if (busy.current || target === null) return;
    setAttempted(true);
    const next: typeof errors = {};
    if (amount === null || amount <= 0) next.amount = C.errAmount;
    else if (amount > MAX_AMOUNT) next.amount = C.errAmountMax;
    else if (amount > target.remaining) next.amount = C.errExceeds(target.direction);
    if (account === undefined) next.account = C.errAccount;
    setErrors(next);
    setGalat(null);
    if (next.amount !== undefined || amount === null) return amountRef.current?.focus();
    if (next.account !== undefined || account === undefined) return accountRef.current?.focus();
    busy.current = true;
    setSaving(true);
    let res: PayResult;
    try {
      res = await onPay({
        clientId,
        debtId: target.debtId,
        accountId: account.id,
        amount,
        occurredOn: date,
        allowNegative: negative || forced,
      });
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (res.ok) {
      onPaid({
        debtId: target.debtId,
        name: target.contactName,
        direction: target.direction,
        amount,
        accountName: account.name,
        entryId: res.entryId,
        version: res.version,
        remaining: res.remaining,
      });
      return;
    }
    switch (res.code) {
      case 'payment_exceeds':
        // Cicilan lain masuk lebih dulu: muat ulang, galat yang sama, `Bayar sisa` memakai sisa baru.
        setServerExceeds(true);
        onRefresh();
        amountRef.current?.focus();
        break;
      case 'saldo_negatif':
        setForced(true);
        break;
      case 'debt_account_kantor':
      case 'account_archived':
        setErrors({ account: utangFailedText(res.code, target.direction) });
        accountRef.current?.focus();
        break;
      case 'payment_before_opened':
      case 'before_opening':
        setErrors({ date: utangFailedText(res.code, target.direction) });
        dateRef.current?.focus();
        break;
      case 'debt_deleted':
      case 'not_found':
        setGalat('gone');
        break;
      case 'idem_mismatch':
        setGalat('idem');
        break;
      case 'invalid':
        if ((res.field ?? '').includes('amount')) {
          setErrors({ amount: amount > MAX_AMOUNT ? C.errAmountMax : C.errAmount });
          amountRef.current?.focus();
        } else {
          setGalat('invalid');
        }
        break;
      case 'network':
        setGalat('network');
        break;
      default:
        setGalat('server');
    }
  }

  const galatText =
    galat === 'idem'
      ? C.errIdem
      : galat === 'invalid'
        ? C.errInvalid
        : galat === 'server'
          ? 'Belum tersimpan. Ada kendala di server. Coba lagi tidak akan mencatat dua kali.'
          : 'Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan mencatat dua kali.';

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
      title={paySheetTitle(target.direction, target.contactName)}
      titleContent={
        <>
          <span className="min-w-0 break-words">
            {lent ? `Terima dari ${target.contactName}` : `Bayar utang ke ${target.contactName}`}
          </span>
          <SpaceTag space="pribadi" />
        </>
      }
      tint="pribadi"
      initialFocus={payable.length > 0 && !gone ? amountRef : undefined}
      footer={
        payable.length > 0 && !gone ? (
          <SaveButton formId={FORM_ID} saving={saving} label={footerLabel} />
        ) : undefined
      }
    >
      {gone ? (
        <Alert
          action={
            <Button variant="secondary" size="sm" onClick={onRefresh}>
              {C.reload}
            </Button>
          }
        >
          {C.paidOffNote}
        </Alert>
      ) : payable.length === 0 ? (
        <NoAccountBlock text={C.noAccountPay} />
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-body font-bold text-text">
              {`${C.remainingOf} ${formatRupiah(target.remaining)}`}
            </span>
            <span className="text-meta font-medium text-text-soft">
              {`dari ${formatRupiah(target.principal)}`}
            </span>
          </p>
          <form
            id={FORM_ID}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void pay();
            }}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <MoneyInput
                label={lent ? C.amountReceived : C.amountPaid}
                value={amount}
                onChange={(v) => {
                  setAmount(v);
                  setForced(false);
                  setServerExceeds(false);
                  setErrors((x) => ({ ...x, amount: undefined }));
                }}
                readOnly={saving}
                inputRef={amountRef}
                {...(amountError === undefined ? {} : { describedBy: errorId })}
              />
              {amountError === undefined ? null : (
                <div role={attempted ? 'alert' : undefined}>
                  <FieldError id={errorId}>{amountError}</FieldError>
                </div>
              )}
              {exceeds ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    setAmount(target.remaining);
                    setServerExceeds(false);
                    setErrors((x) => ({ ...x, amount: undefined }));
                    amountRef.current?.focus();
                  }}
                >
                  {`${lent ? 'Terima' : 'Bayar'} sisa ${formatRupiah(target.remaining)}`}
                </Button>
              ) : null}
            </div>
            {options.length > 0 ? (
              <ChipGroup label={C.quickLabel}>
                {options.map((o, i) => (
                  <Chip
                    key={o.key}
                    selected={chosen === o.key}
                    focusable={chosen === null && i === 0}
                    ariaDisabled={saving}
                    onSelect={() => {
                      setAmount(o.amount);
                      setForced(false);
                      setServerExceeds(false);
                      setErrors((x) => ({ ...x, amount: undefined }));
                    }}
                  >
                    <span aria-hidden="true">{o.label}</span>
                    <span className="sr-only">{o.ariaLabel}</span>
                  </Chip>
                ))}
              </ChipGroup>
            ) : null}
            <div className="grid grid-cols-1 gap-3 min-[390px]:grid-cols-2">
              <SelectField
                label={lent ? C.receivedIn : C.paidFrom}
                value={accountId}
                onChange={(v) => {
                  setAccountId(v);
                  setForced(false);
                  setErrors((x) => ({ ...x, account: undefined }));
                }}
                error={errors.account}
                selectRef={accountRef}
                busy={saving}
              >
                {payable.map((a) => (
                  <option key={a.id} value={a.id} className="bg-surface text-text">
                    {a.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label={lent ? C.dateReceived : C.datePaid}
                value={date}
                onChange={(v) => {
                  setDate(v);
                  setErrors((x) => ({ ...x, date: undefined }));
                }}
                error={errors.date}
                selectRef={dateRef}
                busy={saving}
              >
                {dates.map((d) => (
                  <option key={d} value={d} className="bg-surface text-text">
                    {dayLabel(d, today)}
                  </option>
                ))}
              </SelectField>
            </div>
          </form>
          {preview !== null && account !== undefined && amount !== null ? (
            <div className="flex flex-col gap-1">
              <KolomKas
                caption={C.after}
                rows={[
                  { label: C.remainingNow, value: target.remaining },
                  {
                    label: lent ? 'Diterima' : 'Dibayar',
                    value: -amount,
                    signed: true,
                  },
                ]}
                result={{ label: C.remainingAfter, value: preview.remainingAfter }}
              />
              <FieldHint id={`${errorId}-w`}>
                {walletChangeNote(account.name, preview.walletDelta)}
              </FieldHint>
            </div>
          ) : null}
          {(negative || forced) && account !== undefined ? (
            <WarningBox>
              {forced && !negative
                ? 'Saldo dompet ini tidak cukup. Kalau dibayar, saldonya jadi negatif.'
                : preview === null
                  ? ''
                  : saldoWarning(account.name, account.balance, preview.walletAfter, 'dibayar')}
            </WarningBox>
          ) : null}
          {galat === null ? null : (
            <Alert
              action={
                galat === 'network' || galat === 'server' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void pay();
                    }}
                  >
                    {C.retry}
                  </Button>
                ) : undefined
              }
            >
              {galatText}
            </Alert>
          )}
          <div aria-hidden="true" className="pb-3" />
        </>
      )}
    </Sheet>
  );
}
