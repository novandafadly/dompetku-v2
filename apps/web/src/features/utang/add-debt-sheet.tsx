'use client';

import { shortDateLabel, type IsoDate, type Rupiah } from '@dompetku/domain';
import { useId, useMemo, useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field-messages';
import { MoneyInput } from '@/components/ui/money-input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { TextField } from '@/components/ui/text-field';
import { newClientId } from '@/features/ledger/client-id';
import type { AccountVM, LedgerErrorCode } from '@/features/ledger/types';
import { Alert, payableAccounts, SelectField } from '@/features/rencana/form-parts';
import { UTANG_COPY as C, saldoWarning, sheetTitle } from './copy';
import {
  ContactControl,
  DateInput,
  NoAccountBlock,
  SaveButton,
  WarningBox,
  type ContactChoice,
} from './fields';
import { KolomKas } from './kolom-kas';
import { addPreview } from './present';
import type { ContactVM, DebtDirection, DebtMode } from './types';

const FORM_ID = 'tambah-utang';
const MAX_AMOUNT = 10 ** 13;
const NAME_MAX = 60;

export interface CreateDebtSubmit {
  clientId: string;
  direction: DebtDirection;
  mode: DebtMode;
  principal: Rupiah;
  contactId?: string;
  contactName?: string;
  accountId?: string;
  openedOn: IsoDate;
  title?: string;
  note?: string;
  allowNegative: boolean;
}
export type CreateResult =
  { ok: true; debtId: string } | { ok: false; code: LedgerErrorCode; field?: string };

export interface AddedInfo {
  debtId: string;
  name: string;
  direction: DebtDirection;
  mode: DebtMode;
  amount: Rupiah;
  accountName: string;
}

type Galat = 'network' | 'server' | 'idem' | 'invalid' | 'gone';

interface Errors {
  direction?: string | undefined;
  contact?: string | undefined;
  amount?: string | undefined;
  account?: string | undefined;
  date?: string | undefined;
}

export interface AddDebtSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: readonly AccountVM[];
  contacts: readonly ContactVM[];
  today: IsoDate;
  onCreate: (input: CreateDebtSubmit) => Promise<CreateResult>;
  onCreated: (info: AddedInfo) => void;
}

/**
 * Sheet `Tambah utang` (S11-AD1): utang atau piutang baru, atau yang sudah berjalan (K2), dalam
 * satu sheet. Arah tanpa bawaan (salah arah membalik efek ke dompet). Satu `clientId` per
 * pembukaan: klik ganda dan `Coba lagi` = permintaan yang sama (kontak baru ikut idempoten, C6).
 * Piutang baru yang membuat saldo negatif = peringatan + `Tetap simpan` (pola S6-C3), bukan galat.
 */
export function AddDebtSheet(props: AddDebtSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <AddSession key={session} {...props} />;
}

function AddSession({
  open,
  onOpenChange,
  accounts,
  contacts,
  today,
  onCreate,
  onCreated,
}: AddDebtSheetProps) {
  const payable = payableAccounts(accounts);
  const [clientId] = useState(newClientId);
  const [direction, setDirection] = useState<DebtDirection | null>(null);
  const [contact, setContact] = useState<ContactChoice>({
    mode: contacts.length > 0 ? 'pick' : 'new',
    contactId: '',
    name: '',
  });
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<DebtMode>('baru');
  const [amount, setAmount] = useState<Rupiah | null>(null);
  const [accountId, setAccountId] = useState(
    (payable.find((a) => a.pocket === 'operasional') ?? payable[0])?.id ?? '',
  );
  const [date, setDate] = useState<string>(today);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [forced, setForced] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [galat, setGalat] = useState<Galat | null>(null);
  const busy = useRef(false);
  const directionBox = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const accountRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const modeHintId = useId();
  const dirLabelId = useId();
  const modeLabelId = useId();

  // Fokus awal ke kontrol pertama (Arah): segmen yang jadi titik masuk Tab.
  const firstFocus = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return (
          directionBox.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]') ?? null
        );
      },
    }),
    [],
  );

  const account = payable.find((a) => a.id === accountId);
  const baru = mode === 'baru';
  const preview =
    baru && direction !== null && amount !== null && amount > 0 && account !== undefined
      ? addPreview(direction, amount, account.balance)
      : null;
  const negative = preview !== null && direction === 'lent' && preview.walletAfter < 0;
  const noAccount = baru && payable.length === 0;

  function clearAlerts(key?: keyof Errors) {
    if (key !== undefined) setErrors((e) => ({ ...e, [key]: undefined }));
    setGalat(null);
  }

  async function save() {
    if (busy.current) return;
    const next: Errors = {};
    const name = contact.name.trim();
    if (direction === null) next.direction = C.errDirection;
    if (contact.mode === 'pick' && contact.contactId === '') next.contact = C.errContact;
    if (contact.mode === 'new' && (name.length < 1 || name.length > NAME_MAX)) {
      next.contact = C.errContactName;
    }
    if (amount === null || amount <= 0) next.amount = C.errAmount;
    else if (amount > MAX_AMOUNT) next.amount = C.errAmountMax;
    if (baru && account === undefined) next.account = C.errAccount;
    if (date > today) next.date = C.errDateFuture;
    setErrors(next);
    setGalat(null);
    if (direction === null || next.direction !== undefined) {
      directionBox.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
      return;
    }
    if (next.contact !== undefined) {
      (contact.mode === 'pick' ? selectRef : nameRef).current?.focus();
      return;
    }
    if (next.amount !== undefined || amount === null) return amountRef.current?.focus();
    if (next.account !== undefined) return accountRef.current?.focus();
    if (next.date !== undefined) return dateRef.current?.focus();

    const trimmedTitle = title.trim();
    const trimmedNote = note.trim();
    busy.current = true;
    setSaving(true);
    let res: CreateResult;
    try {
      res = await onCreate({
        clientId,
        direction,
        mode,
        principal: amount,
        ...(contact.mode === 'pick' ? { contactId: contact.contactId } : { contactName: name }),
        ...(baru && account !== undefined ? { accountId: account.id } : {}),
        openedOn: date,
        ...(trimmedTitle === '' ? {} : { title: trimmedTitle }),
        ...(trimmedNote === '' ? {} : { note: trimmedNote }),
        allowNegative: negative || forced,
      });
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (res.ok) {
      const contactName =
        contact.mode === 'new'
          ? name
          : (contacts.find((c) => c.contactId === contact.contactId)?.name ?? name);
      onCreated({
        debtId: res.debtId,
        name: contactName,
        direction,
        mode,
        amount,
        accountName: baru && account !== undefined ? account.name : '',
      });
      return;
    }
    switch (res.code) {
      case 'saldo_negatif':
        setForced(true);
        break;
      case 'contact_name_taken':
        setErrors({ contact: C.errContactNameTaken });
        nameRef.current?.focus();
        break;
      case 'contact_archived':
        setErrors({ contact: 'Kontak ini sudah diarsipkan. Pilih kontak lain.' });
        selectRef.current?.focus();
        break;
      case 'debt_account_kantor':
        setErrors({ account: 'Dompet Kantor tidak bisa dipakai untuk utang. Pilih dompet lain.' });
        accountRef.current?.focus();
        break;
      case 'account_archived':
        setErrors({ account: 'Dompet ini sudah diarsipkan. Pilih dompet lain.' });
        accountRef.current?.focus();
        break;
      case 'before_opening':
        setErrors({
          date: `${account?.name ?? 'Dompet'} baru dicatat sejak ${account === undefined ? '' : shortDateLabel(account.openedOn)}. Pilih tanggal sesudahnya.`,
        });
        dateRef.current?.focus();
        break;
      case 'invalid':
        if ((res.field ?? '').includes('principal')) {
          setErrors({ amount: amount > MAX_AMOUNT ? C.errAmountMax : C.errAmount });
          amountRef.current?.focus();
        } else if ((res.field ?? '').includes('name')) {
          setErrors({ contact: C.errContactName });
          nameRef.current?.focus();
        } else {
          setGalat('invalid');
        }
        break;
      case 'not_found':
        setGalat('gone');
        break;
      case 'idem_mismatch':
        setGalat('idem');
        break;
      case 'network':
        setGalat('network');
        break;
      default:
        setGalat('server');
    }
  }

  const modeNote = baru
    ? direction === 'borrowed'
      ? 'Uangnya masuk ke dompet yang kamu pilih.'
      : direction === 'lent'
        ? 'Uangnya keluar dari dompet yang kamu pilih.'
        : 'Uangnya masuk atau keluar dari dompet yang kamu pilih.'
    : C.runningHint;
  const accountLabel =
    direction === 'borrowed' ? C.accountIn : direction === 'lent' ? C.accountOut : C.accountPlain;
  const saveLabel = negative || forced ? C.saveAnyway : C.save;
  const galatText =
    galat === 'idem'
      ? C.errIdem
      : galat === 'invalid'
        ? C.errInvalid
        : galat === 'gone'
          ? 'Data ini tidak ditemukan. Muat ulang halaman.'
          : galat === 'server'
            ? 'Belum tersimpan. Ada kendala di server. Coba lagi tidak akan mencatat dua kali.'
            : 'Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan mencatat dua kali.';

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
      title={sheetTitle(C.addTitle)}
      titleContent={
        <>
          {C.addTitle}
          <SpaceTag space="pribadi" />
        </>
      }
      tint="pribadi"
      initialFocus={firstFocus}
      footer={<SaveButton formId={FORM_ID} saving={saving} label={saveLabel} />}
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1.5">
          <span id={dirLabelId} className="text-meta font-semibold text-text-soft">
            {C.directionField}
          </span>
          <div ref={directionBox}>
            <SegmentedControl
              labelledBy={dirLabelId}
              items={[
                { value: 'borrowed', label: 'Saya berutang' },
                { value: 'lent', label: 'Piutang' },
              ]}
              value={direction}
              onChange={(v) => {
                setDirection(v === 'lent' ? 'lent' : 'borrowed');
                setForced(false);
                clearAlerts('direction');
              }}
            />
          </div>
          {direction === null ? null : (
            <p id={hintId} className="text-meta font-medium text-text-soft">
              {direction === 'borrowed' ? C.borrowedHint : C.lentHint}
            </p>
          )}
          {errors.direction === undefined ? null : (
            <div role="alert">
              <FieldError id={`${hintId}-e`}>{errors.direction}</FieldError>
            </div>
          )}
        </div>
        <ContactControl
          contacts={contacts}
          value={contact}
          onChange={(v) => {
            setContact(v);
            clearAlerts('contact');
          }}
          error={errors.contact}
          busy={saving}
          selectRef={selectRef}
          nameRef={nameRef}
        />
        <TextField
          label={C.titleField}
          value={title}
          onChange={setTitle}
          optional
          placeholder={C.titlePlaceholder}
          maxLength={80}
          readOnly={saving}
          autoComplete="off"
        />
        <div className="flex flex-col gap-1.5">
          <span id={modeLabelId} className="text-meta font-semibold text-text-soft">
            {C.modeField}
          </span>
          <SegmentedControl
            labelledBy={modeLabelId}
            items={[
              { value: 'baru', label: C.modeNewShort },
              { value: 'berjalan', label: C.modeRunningShort },
            ]}
            value={mode}
            onChange={(v) => {
              setMode(v === 'berjalan' ? 'berjalan' : 'baru');
              setForced(false);
            }}
          />
          <p id={modeHintId} className="text-meta font-medium text-text-soft">
            {modeNote}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <MoneyInput
            label={baru ? C.principalNew : C.principalRunning}
            value={amount}
            onChange={(v) => {
              setAmount(v);
              setForced(false);
              clearAlerts('amount');
            }}
            readOnly={saving}
            inputRef={amountRef}
          />
          {errors.amount === undefined ? null : (
            <div role="alert">
              <FieldError id={`${hintId}-a`}>{errors.amount}</FieldError>
            </div>
          )}
        </div>
        {baru ? (
          noAccount ? (
            <NoAccountBlock text={C.noAccountAdd} />
          ) : (
            <>
              <SelectField
                label={accountLabel}
                value={accountId}
                onChange={(v) => {
                  setAccountId(v);
                  setForced(false);
                  clearAlerts('account');
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
              {preview !== null && account !== undefined && direction !== null ? (
                <KolomKas
                  caption={`Saldo ${account.name} sesudah dicatat`}
                  rows={[
                    { label: `Saldo ${account.name}`, value: account.balance },
                    {
                      label: C.principalNew,
                      value: preview.walletDelta,
                      signed: true,
                    },
                  ]}
                  result={{ label: 'Saldo sesudahnya', value: preview.walletAfter }}
                />
              ) : null}
              {negative && account !== undefined ? (
                <WarningBox>
                  {saldoWarning(account.name, account.balance, preview.walletAfter, 'disimpan')}
                </WarningBox>
              ) : null}
            </>
          )
        ) : null}
        <DateInput
          label={baru ? C.dateNew : C.dateRunning}
          value={date}
          onChange={(v) => {
            setDate(v);
            clearAlerts('date');
          }}
          max={today}
          error={errors.date}
          busy={saving}
          inputRef={dateRef}
        />
        <TextField
          label={C.noteField}
          value={note}
          onChange={setNote}
          optional
          maxLength={200}
          readOnly={saving}
          autoComplete="off"
        />
      </form>
      {forced && !negative && account !== undefined && direction !== null ? (
        <WarningBox>
          Saldo dompet ini tidak cukup. Kalau disimpan, saldonya jadi negatif.
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
                  void save();
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
    </Sheet>
  );
}
