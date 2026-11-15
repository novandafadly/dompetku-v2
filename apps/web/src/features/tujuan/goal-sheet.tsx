'use client';

import type { IsoDate, Rupiah } from '@dompetku/domain';
import { useId, useRef, useState } from 'react';
import { Alert, SelectField } from '@/components/ui/form-parts';
import { FieldError } from '@/components/ui/field-messages';
import { InfoIcon } from '@/components/ui/icons/info';
import { MoneyInput } from '@/components/ui/money-input';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { focusRing } from '@/components/ui/styles';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { newClientId } from '@/features/ledger/client-id';
import type { LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { DateInput, SaveButton } from '@/features/utang/fields';
import { TUJUAN_COPY as C } from './copy';
import { FIELD_DATE, FIELD_NAME, FIELD_TARGET, goalFailedText } from './galat';
import type { GoalVM } from './types';

const FORM_ID = 'tujuan';
const NAME_MAX = 60;
const MAX_TARGET = 10 ** 13;

/** Dompet tabungan aktif ruang ini yang boleh dipilih (tanpa tujuan aktif). */
export interface GoalWallet {
  id: string;
  name: string;
  balance: Rupiah;
}

export interface CreateGoalSubmit {
  clientId: string;
  accountId: string;
  name: string;
  target: Rupiah;
  targetOn?: IsoDate;
}
export interface UpdateGoalSubmit {
  goalId: string;
  name: string;
  target: Rupiah;
  targetOn: IsoDate | null;
}
export type GoalSaveResult = { ok: true } | { ok: false; code: LedgerErrorCode; field?: string };

export interface GoalSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruang: Ruang;
  today: IsoDate;
  /** `null` = Tambah tujuan; terisi = Ubah tujuan itu (dompet terkunci). */
  goal: GoalVM | null;
  wallets: readonly GoalWallet[];
  /** Tambah dari Detail dompet: dompet terkunci (harus ada di `wallets`). */
  lockedWalletId?: string | undefined;
  onCreate: (input: CreateGoalSubmit) => Promise<GoalSaveResult>;
  onUpdate: (input: UpdateGoalSubmit) => Promise<GoalSaveResult>;
  onSaved: (info: { name: string; created: boolean }) => void;
}

interface Errors {
  name?: string | undefined;
  target?: string | undefined;
  wallet?: string | undefined;
  date?: string | undefined;
}

/** Hari ini + 50 tahun (batas isian tanggal target; teks pasti, bukan hitung uang). */
function maxDate(today: IsoDate): IsoDate {
  return `${String(Number(today.slice(0, 4)) + 50)}${today.slice(4)}`;
}

/**
 * Sheet `Tambah tujuan` / `Ubah tujuan` (S13-TJ4, TJ5), satu komponen untuk keduanya. Satu `clientId`
 * per pembukaan: klik ganda dan `Coba lagi` = permintaan yang sama. Tanpa pratinjau `Perlu Rp …`:
 * angkanya dari SQL sesudah simpan (UI tidak membagi). Dompet hanya dipilih saat Tambah dan tidak
 * bisa diganti sesudahnya (K7).
 */
export function GoalSheet(props: GoalSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <GoalSession key={session} {...props} />;
}

function GoalSession({
  open,
  onOpenChange,
  ruang,
  today,
  goal,
  wallets,
  lockedWalletId,
  onCreate,
  onUpdate,
  onSaved,
}: GoalSheetProps) {
  const editing = goal !== null;
  const [clientId] = useState(newClientId);
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState<Rupiah | null>(goal?.target ?? null);
  const [walletId, setWalletId] = useState(
    lockedWalletId ?? (wallets.length === 1 ? (wallets[0]?.id ?? '') : ''),
  );
  const [date, setDate] = useState<string>(goal?.targetOn ?? '');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [galat, setGalat] = useState<{ text: string; retry: boolean } | null>(null);
  const busy = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<HTMLInputElement>(null);
  const walletRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const targetErrId = useId();
  const noteId = useId();

  const wallet = wallets.find((w) => w.id === walletId);
  const walletName = goal?.accountName ?? wallet?.name ?? 'Dompet ini';
  const locked = editing || lockedWalletId !== undefined;
  const noWallet = !editing && wallets.length === 0;
  // Tanggal lama yang sudah lewat tetap boleh dipertahankan saat Ubah (bingkai TJ5).
  const dateMin = goal?.targetOn != null && goal.targetOn < today ? goal.targetOn : today;

  function clear(key?: keyof Errors) {
    if (key !== undefined) setErrors((e) => ({ ...e, [key]: undefined }));
    setGalat(null);
  }

  async function save() {
    if (busy.current || noWallet) return;
    const trimmed = name.trim();
    const next: Errors = {};
    if (trimmed.length < 1 || trimmed.length > NAME_MAX) next.name = FIELD_NAME;
    if (target === null || target <= 0 || target > MAX_TARGET) next.target = FIELD_TARGET;
    if (!editing && walletId === '') next.wallet = goalFailedText('goal_pocket_invalid');
    if (date !== '' && date !== goal?.targetOn && date < today) {
      next.date = goalFailedText('goal_target_past');
    }
    setErrors(next);
    setGalat(null);
    if (next.name !== undefined) return nameRef.current?.focus();
    if (next.target !== undefined || target === null) return targetRef.current?.focus();
    if (next.wallet !== undefined) return walletRef.current?.focus();
    if (next.date !== undefined) return dateRef.current?.focus();

    if (
      goal !== null &&
      trimmed === goal.name &&
      target === goal.target &&
      (date === '' ? null : date) === goal.targetOn
    ) {
      onOpenChange(false); // tanpa perubahan: tutup tanpa toast, tanpa memanggil server
      return;
    }

    busy.current = true;
    setSaving(true);
    let res: GoalSaveResult;
    try {
      res =
        goal === null
          ? await onCreate({
              clientId,
              accountId: walletId,
              name: trimmed,
              target,
              ...(date === '' ? {} : { targetOn: date }),
            })
          : await onUpdate({
              goalId: goal.goalId,
              name: trimmed,
              target,
              targetOn: date === '' ? null : date,
            });
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (res.ok) {
      onSaved({ name: trimmed, created: goal === null });
      return;
    }
    switch (res.code) {
      case 'goal_exists':
      case 'goal_pocket_invalid':
      case 'account_archived':
        setErrors({ wallet: goalFailedText(res.code, walletName) });
        walletRef.current?.focus();
        break;
      case 'goal_target_past':
        setErrors({ date: goalFailedText('goal_target_past') });
        dateRef.current?.focus();
        break;
      case 'invalid': {
        const field = res.field ?? '';
        if (/target_?on/i.test(field)) {
          setErrors({ date: FIELD_DATE });
          dateRef.current?.focus();
        } else if (field.includes('target')) {
          setErrors({ target: FIELD_TARGET });
          targetRef.current?.focus();
        } else if (field.includes('name')) {
          setErrors({ name: FIELD_NAME });
          nameRef.current?.focus();
        } else if (field.includes('account')) {
          setErrors({ wallet: goalFailedText('goal_pocket_invalid') });
          walletRef.current?.focus();
        } else {
          setGalat({ text: goalFailedText('unknown'), retry: true });
        }
        break;
      }
      case 'network':
      case 'unknown':
        setGalat({ text: goalFailedText(res.code), retry: true });
        break;
      default:
        setGalat({ text: goalFailedText(res.code, walletName), retry: false });
    }
  }

  const left = NAME_MAX - name.length;
  const nameHint = name.length >= 50 ? `${C.nameLeft(left)} ${C.nameHint}` : C.nameHint;
  const baseTitle = editing ? C.editTitle : C.addTitle;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
      title={C.sheetTitle(baseTitle, ruang)}
      titleContent={
        <>
          {baseTitle}
          <SpaceTag space={ruang} />
        </>
      }
      tint={ruang}
      initialFocus={nameRef}
      footer={
        <SaveButton
          formId={FORM_ID}
          saving={saving}
          disabled={noWallet}
          label={editing ? C.saveChanges : C.save}
        />
      }
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
        <TextField
          label={C.nameField}
          value={name}
          onChange={(v) => {
            setName(v);
            clear('name');
          }}
          error={errors.name}
          hint={nameHint}
          maxLength={NAME_MAX}
          readOnly={saving}
          autoComplete="off"
          inputRef={nameRef}
        />
        <div className="flex flex-col gap-1.5">
          <MoneyInput
            label={C.targetField}
            value={target}
            onChange={(v) => {
              setTarget(v);
              clear('target');
            }}
            readOnly={saving}
            inputRef={targetRef}
            {...(errors.target === undefined ? {} : { describedBy: targetErrId })}
          />
          {errors.target === undefined ? null : (
            <div role="alert">
              <FieldError id={targetErrId}>{errors.target}</FieldError>
            </div>
          )}
        </div>
        {locked ? (
          <div className="flex flex-col gap-1">
            <p className="text-body font-semibold break-words text-text">
              {C.walletLocked(walletName)}
            </p>
            {editing ? (
              <p className="text-caption font-medium text-text-muted">{C.walletLockedNote}</p>
            ) : wallet === undefined ? null : (
              <WalletNote wallet={wallet} id={noteId} />
            )}
          </div>
        ) : noWallet ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-lg bg-surface-2 p-3 text-meta font-medium text-text-soft"
          >
            <InfoIcon size={14} className="mt-0.5 shrink-0" />
            <span className="text-pretty">{C.allHaveGoals}</span>
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <SelectField
              label={C.walletField}
              value={walletId}
              onChange={(v) => {
                setWalletId(v);
                clear('wallet');
              }}
              error={errors.wallet}
              hint={C.walletOnlySavings}
              selectRef={walletRef}
              busy={saving}
            >
              {wallets.length === 1 ? null : (
                <option value="" className="bg-surface text-text">
                  Pilih dompet
                </option>
              )}
              {wallets.map((w) => (
                <option key={w.id} value={w.id} title={w.name} className="bg-surface text-text">
                  {w.name}
                </option>
              ))}
            </SelectField>
            {wallet === undefined ? null : <WalletNote wallet={wallet} id={noteId} />}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <DateInput
            label={C.dateField}
            value={date}
            onChange={(v) => {
              setDate(v);
              clear('date');
            }}
            min={dateMin}
            max={maxDate(today)}
            error={errors.date}
            busy={saving}
            inputRef={dateRef}
          />
          {date !== '' ? (
            <button
              type="button"
              onClick={() => {
                setDate('');
                clear('date');
              }}
              className={`inline-flex min-h-11 items-center self-start rounded-md px-1 text-label font-bold text-accent-text hover-pointer:underline ${focusRing}`}
            >
              {C.clearDate}
            </button>
          ) : null}
          <p className="text-caption font-medium text-text-muted">{C.dateHint}</p>
        </div>
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
                {C.retry}
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

/** Satu kalimat dari saldo yang sudah dimuat (tanpa menghitung): ada isi atau masih kosong. */
function WalletNote({ wallet, id }: { wallet: GoalWallet; id: string }) {
  return (
    <p id={id} className="text-meta font-medium text-text-soft">
      {wallet.balance > 0
        ? C.walletHasMoney(wallet.name, wallet.balance)
        : C.walletEmpty(wallet.name)}
    </p>
  );
}
