'use client';

import {
  addDays,
  dayLabel,
  formatRupiah,
  shortDateLabel,
  type IsoDate,
  type Rupiah,
} from '@dompetku/domain';
import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { Button, buttonClass } from '@/components/ui/button';
import { FieldHint, FieldError } from '@/components/ui/field-messages';
import { CircleNotchIcon } from '@/components/ui/icons/circle-notch';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { WarningIcon } from '@/components/ui/icons/warning';
import { MoneyInput } from '@/components/ui/money-input';
import { Sheet } from '@/components/ui/sheet';
import { focusRing } from '@/components/ui/styles';
import { SpaceTag } from '@/components/ui/space-tag';
import { newClientId } from '@/features/ledger/client-id';
import type { AccountVM, LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { Alert, payableAccounts, SelectField, type BillResult } from './bill-sheet';
import type { BillItem } from './bills';
import {
  accountArchivedBillText,
  MAX_AMOUNT,
  saldoKurangBayarText,
  TAGIHAN_COPY as C,
} from './copy';

const FORM_ID = 'bayar-tagihan';
/** Tanggal bayar: hari ini sampai 13 hari lalu (pola Catat); bayar di muka tetap bertanggal hari ini. */
const DATE_CHOICES = 14;

export interface PaySubmit {
  clientId: string;
  occurrenceId: string;
  accountId: string;
  occurredOn: IsoDate;
  amount: Rupiah;
  allowNegative: boolean;
}
export type PayResult =
  | { ok: true; entryId: string; version: number }
  | { ok: false; code: LedgerErrorCode; field?: string };

type Galat = 'network' | 'server' | 'posted' | 'gone' | 'archived' | 'idem' | 'invalid';

export interface PaidInfo {
  name: string;
  amount: Rupiah;
  accountName: string;
  entryId: string;
  version: number;
}

interface FormProps {
  ruang: Ruang;
  item: BillItem & { occ: NonNullable<BillItem['occ']> };
  accounts: readonly AccountVM[];
  today: IsoDate;
  saving: boolean;
  setSaving: (v: boolean) => void;
  amount: Rupiah | null;
  setAmount: (v: Rupiah | null) => void;
  saldo: boolean;
  setSaldo: (v: boolean) => void;
  amountRef: React.RefObject<HTMLInputElement | null>;
  onPay: (input: PaySubmit) => Promise<PayResult>;
  onSkip: (occurrenceId: string) => Promise<BillResult>;
  onPaid: (info: PaidInfo) => void;
  onSkipped: () => void;
  onReload: () => void;
}

function Form(p: FormProps) {
  const { occ, bill } = p.item;
  const payable = payableAccounts(p.accounts);
  const [clientId] = useState(newClientId);
  const { amount, setAmount, saldo, setSaldo } = p;
  const [accountId, setAccountId] = useState(
    bill.accountId !== null && payable.some((a) => a.id === bill.accountId)
      ? bill.accountId
      : (payable[0]?.id ?? ''),
  );
  const [date, setDate] = useState<string>(p.today);
  const [errors, setErrors] = useState<{
    amount?: string | undefined;
    account?: string | undefined;
    date?: string | undefined;
  }>({});
  const [galat, setGalat] = useState<Galat | null>(null);
  const busy = useRef(false);
  const accountRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLSelectElement>(null);
  const amountHintId = useId();
  const amountErrorId = useId();
  const saldoId = useId();
  const account = payable.find((a) => a.id === accountId);
  const dates = Array.from({ length: DATE_CHOICES }, (_, i) => addDays(p.today, -i));

  async function pay() {
    if (busy.current) return;
    const next: typeof errors = {};
    if (amount === null || amount <= 0) next.amount = C.errAmount;
    else if (amount > MAX_AMOUNT) next.amount = C.errAmountMax;
    if (account === undefined) next.account = C.errPickAccount;
    setErrors(next);
    setGalat(null);
    if (next.amount !== undefined || amount === null) return p.amountRef.current?.focus();
    if (next.account !== undefined || account === undefined) return accountRef.current?.focus();
    busy.current = true;
    p.setSaving(true);
    let res: PayResult;
    try {
      res = await p.onPay({
        clientId,
        occurrenceId: occ.occurrenceId,
        accountId: account.id,
        occurredOn: date,
        amount,
        allowNegative: saldo,
      });
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
      p.setSaving(false);
    }
    if (res.ok) {
      p.onPaid({
        name: bill.name,
        amount,
        accountName: account.name,
        entryId: res.entryId,
        version: res.version,
      });
      return;
    }
    switch (res.code) {
      case 'saldo_negatif':
        setSaldo(true);
        break;
      case 'already_posted':
        setGalat('posted');
        break;
      case 'bill_archived':
        setGalat('archived');
        break;
      case 'not_found':
        setGalat('gone');
        break;
      case 'idem_mismatch':
        setGalat('idem');
        break;
      case 'bill_account_kantor':
        setErrors({ account: C.errKantor });
        accountRef.current?.focus();
        break;
      case 'account_archived':
        setErrors({ account: accountArchivedBillText(account.name) });
        accountRef.current?.focus();
        break;
      case 'before_opening':
        setErrors({
          date: `${account.name} baru dicatat sejak ${shortDateLabel(account.openedOn)}. Pilih tanggal ${shortDateLabel(account.openedOn)} atau sesudahnya.`,
        });
        dateRef.current?.focus();
        break;
      case 'invalid':
        if ((res.field ?? '').includes('amount')) {
          setErrors({ amount: amount > MAX_AMOUNT ? C.errAmountMax : C.errAmount });
          p.amountRef.current?.focus();
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

  async function skip() {
    if (busy.current) return;
    busy.current = true;
    p.setSaving(true);
    setGalat(null);
    let res: BillResult;
    try {
      res = await p.onSkip(occ.occurrenceId);
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
      p.setSaving(false);
    }
    if (res.ok) {
      p.onSkipped();
      return;
    }
    if (res.code === 'already_posted') setGalat('posted');
    else if (res.code === 'bill_archived') setGalat('archived');
    else if (res.code === 'not_found') setGalat('gone');
    else setGalat(res.code === 'network' ? 'network' : 'server');
  }

  const amountDescribedBy = [amountHintId, errors.amount === undefined ? null : amountErrorId]
    .filter((x) => x !== null)
    .join(' ');
  const late = occ.overdue ? -occ.daysUntil : 0;

  if (payable.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 pb-1">
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-toast bg-accent-tint text-accent-text"
        >
          <WalletIcon size={24} />
        </span>
        <p className="text-body font-semibold text-text text-pretty">{C.noAccount(p.ruang)}</p>
        <Link
          href={`/${p.ruang}/dompet?tambah=1`}
          className={buttonClass('primary', 'md', 'w-full')}
        >
          {C.addAccount}
        </Link>
      </div>
    );
  }

  return (
    <>
      <p
        className={`flex flex-wrap items-center gap-x-1.5 text-label font-medium ${occ.overdue ? 'text-danger' : 'text-text-soft'}`}
      >
        {occ.overdue ? <WarningCircleIcon size={16} weight="fill" className="shrink-0" /> : null}
        <span>
          {C.dueOn(shortDateLabel(occ.dueOn))}
          {occ.overdue ? <span className="font-bold">{` · ${C.lateDays(late)}`}</span> : null}
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
            label={C.payAmount}
            value={amount}
            onChange={(v) => {
              setAmount(v);
              setSaldo(false);
              setErrors((x) => ({ ...x, amount: undefined }));
            }}
            readOnly={p.saving}
            inputRef={p.amountRef}
            describedBy={amountDescribedBy}
          />
          <FieldHint id={amountHintId}>{C.estimate(formatRupiah(bill.amount))}</FieldHint>
          {errors.amount === undefined ? null : (
            <div role="alert">
              <FieldError id={amountErrorId}>{errors.amount}</FieldError>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 min-[390px]:grid-cols-2">
          <SelectField
            label={C.payAccount}
            value={accountId}
            onChange={(v) => {
              setAccountId(v);
              setSaldo(false);
              setErrors((x) => ({ ...x, account: undefined }));
            }}
            error={errors.account}
            selectRef={accountRef}
            busy={p.saving}
          >
            {payable.map((a) => (
              <option key={a.id} value={a.id} className="bg-surface text-text">
                {a.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={C.payDate}
            value={date}
            onChange={(v) => {
              setDate(v);
              setErrors((x) => ({ ...x, date: undefined }));
            }}
            error={errors.date}
            selectRef={dateRef}
            busy={p.saving}
          >
            {dates.map((d) => (
              <option key={d} value={d} className="bg-surface text-text">
                {dayLabel(d, p.today)}
              </option>
            ))}
          </SelectField>
        </div>
      </form>
      {saldo && account !== undefined && amount !== null ? (
        <p
          id={saldoId}
          role="status"
          className="flex items-start gap-2 rounded-lg bg-warning-tint p-3 text-label font-semibold text-warning"
        >
          <WarningIcon size={18} weight="fill" className="mt-px shrink-0" />
          <span className="text-pretty">
            {saldoKurangBayarText(
              account.name,
              formatRupiah(account.balance),
              formatRupiah(account.balance - amount),
            )}
          </span>
        </p>
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
                Coba lagi
              </Button>
            ) : galat === 'posted' || galat === 'gone' || galat === 'archived' ? (
              <Button variant="secondary" size="sm" onClick={p.onReload}>
                {C.reload}
              </Button>
            ) : undefined
          }
        >
          {galat === 'network'
            ? C.errNetwork
            : galat === 'server'
              ? C.errServer
              : galat === 'posted'
                ? C.errAlreadyPosted
                : galat === 'gone'
                  ? C.errBillGone
                  : galat === 'archived'
                    ? C.errBillArchived
                    : galat === 'idem'
                      ? C.errIdem
                      : C.errInvalid}
        </Alert>
      )}
      <div className="flex flex-col items-start gap-1 pt-1">
        <button
          type="button"
          aria-disabled={p.saving || undefined}
          onClick={() => {
            if (!p.saving) void skip();
          }}
          className={`inline-flex min-h-11 items-center rounded-md text-label font-bold text-text-soft underline underline-offset-2 hover-pointer:text-text aria-disabled:text-text-muted ${focusRing}`}
        >
          {C.skip}
        </button>
        <p className="text-caption font-medium text-text-muted">{C.skipHint}</p>
      </div>
    </>
  );
}

export interface PayBillSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruang: Ruang;
  /** Kemunculan terbuka yang dibayar (snapshot saat sheet dibuka). */
  item: (BillItem & { occ: NonNullable<BillItem['occ']> }) | null;
  accounts: readonly AccountVM[];
  today: IsoDate;
  onPay: (input: PaySubmit) => Promise<PayResult>;
  onSkip: (occurrenceId: string) => Promise<BillResult>;
  onPaid: (info: PaidInfo) => void;
  onSkipped: (name: string, occurrenceId: string) => void;
  /** `already_posted`: tutup sheet dan muat ulang halaman. */
  onReload: () => void;
}

/**
 * Sheet `Bayar tagihan` (S9-TG3; alur uang). Satu `clientId` per pembukaan: klik ganda dan
 * "Coba lagi" = permintaan yang sama (satu entri). Saldo kurang = peringatan + `Tetap bayar`
 * (pola S6-C3), bukan galat. Nominal aktual boleh beda dari perkiraan (K12). Tanpa nominal di galat.
 */
export function PayBillSheet(props: PayBillSheetProps) {
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
  ruang,
  item,
  accounts,
  today,
  onPay,
  onSkip,
  onPaid,
  onSkipped,
  onReload,
}: PayBillSheetProps) {
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState<Rupiah | null>(item?.occ.amount ?? null);
  const [saldo, setSaldo] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  if (item === null) return null;
  const hasAccount = payableAccounts(accounts).length > 0;
  const label = saldo
    ? C.payAnyway
    : C.payButton(amount !== null && amount > 0 ? formatRupiah(amount) : null);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
      title={C.payTitle(item.bill.name, ruang)}
      titleContent={
        <>
          Bayar {item.bill.name}
          <SpaceTag space={ruang} />
        </>
      }
      tint={ruang}
      initialFocus={hasAccount ? amountRef : undefined}
      footer={
        hasAccount ? (
          <Button
            type="submit"
            form={FORM_ID}
            aria-disabled={saving || undefined}
            aria-busy={saving || undefined}
            className="w-full aria-disabled:border-hairline aria-disabled:bg-surface-2 aria-disabled:text-text-muted aria-disabled:hover-pointer:bg-surface-2"
          >
            {saving ? (
              <>
                <CircleNotchIcon
                  size={18}
                  weight="bold"
                  className="shrink-0 motion-safe:animate-spin"
                />
                Menyimpan…
              </>
            ) : (
              label
            )}
          </Button>
        ) : undefined
      }
    >
      <Form
        ruang={ruang}
        item={item}
        accounts={accounts}
        today={today}
        saving={saving}
        setSaving={setSaving}
        amount={amount}
        setAmount={setAmount}
        saldo={saldo}
        setSaldo={setSaldo}
        amountRef={amountRef}
        onPay={onPay}
        onSkip={onSkip}
        onPaid={onPaid}
        onSkipped={() => {
          onSkipped(item.bill.name, item.occ.occurrenceId);
        }}
        onReload={onReload}
      />
    </Sheet>
  );
}
