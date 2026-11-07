'use client';

import { monthName, shortDateLabel, type IsoDate, type Rupiah } from '@dompetku/domain';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FieldLabel, fieldShell } from '@/components/ui/field';
import { FieldError, FieldHint } from '@/components/ui/field-messages';
import { CaretDownIcon } from '@/components/ui/icons/caret-down';
import { CircleNotchIcon } from '@/components/ui/icons/circle-notch';
import { InfoIcon } from '@/components/ui/icons/info';
import { TrashIcon } from '@/components/ui/icons/trash';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { MoneyInput } from '@/components/ui/money-input';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { toast } from '@/components/ui/toast';
import { newClientId } from '@/features/ledger/client-id';
import type { AccountVM, CategoryVM, LedgerErrorCode, Ruang } from '@/features/ledger/types';
import {
  accountArchivedBillText,
  MAX_AMOUNT,
  obligationDoubleBillText,
  TAGIHAN_COPY as C,
} from './copy';
import type { BillListVM } from './types';

const FORM_ID = 'tagihan';
const NAME_MAX = 60;

export interface CreateBillSubmit {
  clientId: string;
  name: string;
  amount: Rupiah;
  categoryId: string;
  dayOfMonth: number;
  startsOn: IsoDate;
  endsOn: IsoDate | null;
  accountId: string | null;
}
export interface UpdateBillSubmit {
  billId: string;
  name: string;
  amount: Rupiah;
  categoryId: string;
  dayOfMonth: number;
  endsOn: IsoDate | null;
  accountId: string | null;
}

/** Hasil Server Action yang diteruskan pulau klien; galat jaringan sudah dipetakan jadi `network`. */
export type BillResult = { ok: true } | { ok: false; code: LedgerErrorCode; field?: string };

type Galat = 'network' | 'server' | 'gone' | 'archived' | 'invalid';
interface FieldErrors {
  name?: string | undefined;
  amount?: string | undefined;
  category?: string | undefined;
  account?: string | undefined;
  endsOn?: string | undefined;
}

export function Alert({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-lg bg-danger-tint p-3 text-label font-semibold text-danger"
    >
      <p className="flex items-start gap-2">
        <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" />
        <span className="text-pretty">{children}</span>
      </p>
      {action}
    </div>
  );
}

const SELECT =
  'h-12 w-full min-w-0 appearance-none truncate rounded-lg border border-border bg-bg pr-9 pl-3.5 text-body font-medium text-text hover-pointer:bg-hover disabled:border-hairline disabled:text-text-muted aria-invalid:border-2 aria-invalid:border-danger';

/** `<select>` bawaan berlabel terlihat + caret; galat kolom `role="alert"`. */
export function SelectField({
  label,
  value,
  onChange,
  error,
  hint,
  selectRef,
  busy,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
  selectRef?: React.RefObject<HTMLSelectElement | null> | undefined;
  busy: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-e`;
  const hintId = `${id}-h`;
  const describedBy =
    [hint === undefined ? null : hintId, error === undefined ? null : errorId]
      .filter((x) => x !== null)
      .join(' ') || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <select
          id={id}
          ref={selectRef}
          value={value}
          aria-invalid={error !== undefined || undefined}
          aria-describedby={describedBy}
          aria-disabled={busy || undefined}
          onChange={(e) => {
            if (!busy) onChange(e.target.value);
          }}
          className={SELECT}
        >
          {children}
        </select>
        <CaretDownIcon
          size={16}
          weight="bold"
          className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-text-soft"
        />
      </div>
      {error === undefined ? null : (
        <div role="alert">
          <FieldError id={errorId}>{error}</FieldError>
        </div>
      )}
      {hint === undefined ? null : <FieldHint id={hintId}>{hint}</FieldHint>}
    </div>
  );
}

/** Kategori pengeluaran aktif, induk lalu anaknya (`optgroup` per induk). */
export function CategoryOptions({
  categories,
  extra,
}: {
  categories: readonly CategoryVM[];
  /** Kategori terarsip yang masih dipakai tagihan ini: tampil nonaktif supaya nilai terbaca. */
  extra?: { id: string; name: string } | undefined;
}) {
  const expense = categories.filter((c) => c.type === 'expense' && !c.archived);
  const roots = expense.filter((c) => c.parentId === null);
  return (
    <>
      <option value="">{C.pickCategory}</option>
      {extra === undefined ? null : (
        <option value={extra.id} disabled>
          {extra.name} (diarsipkan)
        </option>
      )}
      {roots.map((r) => (
        <optgroup key={r.id} label={r.name}>
          <option value={r.id} className="bg-surface text-text">
            {r.name}
          </option>
          {expense
            .filter((c) => c.parentId === r.id)
            .map((c) => (
              <option key={c.id} value={c.id} className="bg-surface text-text">
                {c.name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

/** Dompet yang boleh membayar tagihan: ruang ini, aktif, bukan Kas Kantor. */
export function payableAccounts(accounts: readonly AccountVM[]): AccountVM[] {
  return accounts.filter((a) => !a.archived && a.pocket !== 'kantor');
}

function DateField({
  label,
  value,
  onChange,
  error,
  hint,
  inputRef,
  busy,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  busy: boolean;
}) {
  const id = useId();
  const errorId = `${id}-e`;
  const hintId = `${id}-h`;
  const textId = `${id}-t`;
  const describedBy =
    [textId, hint === undefined ? null : hintId, error === undefined ? null : errorId]
      .filter((x) => x !== null)
      .join(' ') || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className={`${fieldShell(error !== undefined)} px-3.5`}>
        <input
          id={id}
          ref={inputRef}
          type="date"
          value={value}
          min="2020-01-01"
          max="2099-12-31"
          aria-invalid={error !== undefined || undefined}
          aria-describedby={describedBy}
          aria-disabled={busy || undefined}
          onChange={(e) => {
            if (!busy) onChange(e.target.value);
          }}
          className="min-h-11 w-full min-w-0 bg-transparent text-body font-medium text-text outline-none"
        />
      </div>
      {/* Teks pasti: pemilih tanggal browser memakai format lokal (11/07 bisa terbaca 11 Juli). */}
      <p id={textId} className="text-meta font-semibold text-text-soft">
        {value === '' ? 'Belum diisi' : fullDate(value)}
      </p>
      {error === undefined ? null : (
        <div role="alert">
          <FieldError id={errorId}>{error}</FieldError>
        </div>
      )}
      {hint === undefined ? null : <FieldHint id={hintId}>{hint}</FieldHint>}
    </div>
  );
}

/** `2026-11-07` → `7 Nov 2026`. */
function fullDate(d: string): string {
  return `${shortDateLabel(d)} ${d.slice(0, 4)}`;
}

const rootOf = (categories: readonly CategoryVM[], id: string): CategoryVM | null => {
  const c = categories.find((x) => x.id === id);
  if (c === undefined) return null;
  return c.parentId === null ? c : (categories.find((x) => x.id === c.parentId) ?? c);
};

interface FormProps {
  ruang: Ruang;
  bill: BillListVM | null;
  accounts: readonly AccountVM[];
  categories: readonly CategoryVM[];
  today: IsoDate;
  /** rootCategoryId → anggaran wajib periode ini ada (salinan `obligation_double`). */
  wajibRoots: Readonly<Record<string, true>>;
  saving: boolean;
  setSaving: (v: boolean) => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
  amountRef: React.RefObject<HTMLInputElement | null>;
  onCreate: (input: CreateBillSubmit) => Promise<BillResult>;
  onUpdate: (input: UpdateBillSubmit) => Promise<BillResult>;
  onArchive: () => void;
  onReload: () => void;
  onDone: (name: string, billId: string | null) => void;
}

function Form(p: FormProps) {
  const { bill } = p;
  const editing = bill !== null;
  const payable = payableAccounts(p.accounts);
  const [clientId] = useState(newClientId);
  const [name, setName] = useState(bill?.name ?? '');
  const [amount, setAmount] = useState<Rupiah | null>(bill?.amount ?? null);
  const [categoryId, setCategoryId] = useState(bill?.categoryId ?? '');
  const [accountId, setAccountId] = useState(
    bill?.accountId != null && payable.some((a) => a.id === bill.accountId) ? bill.accountId : '',
  );
  const [day, setDay] = useState(String(bill?.dayOfMonth ?? 1));
  const [startsOn, setStartsOn] = useState<string>(bill?.startsOn ?? p.today);
  const [endsOn, setEndsOn] = useState<string>(bill?.endsOn ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [galat, setGalat] = useState<Galat | null>(null);
  const busy = useRef(false);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const accountRef = useRef<HTMLSelectElement>(null);
  const endsRef = useRef<HTMLInputElement>(null);
  const amountHintId = useId();
  const amountErrorId = useId();
  const archivedCategory =
    bill !== null && !p.categories.some((c) => c.id === bill.categoryId && !c.archived)
      ? { id: bill.categoryId, name: bill.categoryName }
      : undefined;
  const monthStart = `${p.today.slice(0, 7)}-01`;
  const pastStart = !editing && startsOn !== '' && startsOn < monthStart;

  async function submit() {
    if (busy.current) return;
    const next: FieldErrors = {};
    const trimmed = name.trim();
    if (trimmed === '' || trimmed.length > NAME_MAX) next.name = C.errName;
    if (amount === null || amount <= 0) next.amount = C.errAmount;
    else if (amount > MAX_AMOUNT) next.amount = C.errAmountMax;
    if (categoryId === '') next.category = C.errCategory;
    if (!editing && startsOn === '') next.endsOn = C.errStartsOn;
    else if (endsOn !== '' && endsOn < startsOn) next.endsOn = C.errEndsOn;
    setErrors(next);
    setGalat(null);
    if (next.name !== undefined) return p.nameRef.current?.focus();
    if (next.amount !== undefined || amount === null) return p.amountRef.current?.focus();
    if (next.category !== undefined) return categoryRef.current?.focus();
    if (next.endsOn !== undefined) return endsRef.current?.focus();
    busy.current = true;
    p.setSaving(true);
    const common = {
      name: trimmed,
      amount,
      categoryId,
      dayOfMonth: Number(day),
      endsOn: endsOn === '' ? null : endsOn,
      accountId: accountId === '' ? null : accountId,
    };
    let res: BillResult;
    try {
      res = bill
        ? await p.onUpdate({ billId: bill.billId, ...common })
        : await p.onCreate({ clientId, startsOn, ...common });
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
      p.setSaving(false);
    }
    if (res.ok) {
      p.onDone(trimmed, bill?.billId ?? null);
      return;
    }
    switch (res.code) {
      case 'obligation_double': {
        const root = rootOf(p.categories, categoryId);
        const chosen = p.categories.find((c) => c.id === categoryId);
        setErrors({
          category: obligationDoubleBillText(
            chosen?.name ?? 'ini',
            root !== null && p.wajibRoots[root.id] ? root.name : null,
          ),
        });
        categoryRef.current?.focus();
        break;
      }
      case 'bill_account_kantor':
        setErrors({ account: C.errKantor });
        accountRef.current?.focus();
        break;
      case 'account_archived': {
        const a = p.accounts.find((x) => x.id === accountId);
        setErrors({ account: accountArchivedBillText(a?.name ?? 'Dompet ini') });
        accountRef.current?.focus();
        break;
      }
      case 'category_archived': {
        const c = p.categories.find((x) => x.id === categoryId);
        setErrors({
          category: `${c?.name ?? 'Kategori ini'} sudah diarsipkan. Pilih kategori lain.`,
        });
        categoryRef.current?.focus();
        break;
      }
      case 'bill_archived':
        setGalat('archived');
        break;
      case 'not_found':
        setGalat('gone');
        break;
      case 'invalid': {
        const f = (res.field ?? '').replaceAll('_', '').toLowerCase();
        if (f.includes('name')) {
          setErrors({ name: C.errName });
          p.nameRef.current?.focus();
        } else if (f.includes('amount')) {
          setErrors({ amount: amount > MAX_AMOUNT ? C.errAmountMax : C.errAmount });
          p.amountRef.current?.focus();
        } else if (f.includes('endson')) {
          setErrors({ endsOn: C.errEndsOn });
          endsRef.current?.focus();
        } else if (f.includes('categor')) {
          setErrors({ category: C.errCategory });
          categoryRef.current?.focus();
        } else {
          setGalat('invalid');
        }
        break;
      }
      case 'network':
        setGalat('network');
        break;
      default:
        setGalat('server');
    }
  }

  const amountDescribedBy = [amountHintId, errors.amount === undefined ? null : amountErrorId]
    .filter((x) => x !== null)
    .join(' ');
  const selectedCategory = p.categories.find((c) => c.id === categoryId);

  return (
    <>
      {editing ? (
        <p className="flex items-start gap-2 text-label font-medium text-text-soft">
          <InfoIcon size={18} className="mt-px shrink-0" />
          <span className="text-pretty">{C.editNote}</span>
        </p>
      ) : null}
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
      >
        <NameField
          value={name}
          onChange={(v) => {
            setName(v);
            setErrors((x) => ({ ...x, name: undefined }));
          }}
          error={errors.name}
          inputRef={p.nameRef}
          readOnly={p.saving}
        />
        <div className="flex flex-col gap-1.5">
          <MoneyInput
            label={C.amount}
            value={amount}
            onChange={(v) => {
              setAmount(v);
              setErrors((x) => ({ ...x, amount: undefined }));
            }}
            readOnly={p.saving}
            inputRef={p.amountRef}
            describedBy={amountDescribedBy}
          />
          <FieldHint id={amountHintId}>{C.amountHint}</FieldHint>
          {errors.amount === undefined ? null : (
            <div role="alert">
              <FieldError id={amountErrorId}>{errors.amount}</FieldError>
            </div>
          )}
        </div>
        <SelectField
          label={C.category}
          value={categoryId}
          onChange={(v) => {
            setCategoryId(v);
            setErrors((x) => ({ ...x, category: undefined }));
          }}
          error={errors.category}
          hint={
            selectedCategory?.parentId == null
              ? undefined
              : (p.categories.find((c) => c.id === selectedCategory.parentId)?.name ?? undefined)
          }
          selectRef={categoryRef}
          busy={p.saving}
        >
          <CategoryOptions categories={p.categories} extra={archivedCategory} />
        </SelectField>
        <SelectField
          label={C.account}
          value={accountId}
          onChange={(v) => {
            setAccountId(v);
            setErrors((x) => ({ ...x, account: undefined }));
          }}
          error={errors.account}
          hint={
            bill?.accountId != null && !payable.some((a) => a.id === bill.accountId)
              ? C.archivedAccount(bill.accountName ?? 'ini')
              : undefined
          }
          selectRef={accountRef}
          busy={p.saving}
        >
          <option value="">{C.pickAtPay}</option>
          {payable.map((a) => (
            <option key={a.id} value={a.id} className="bg-surface text-text">
              {a.name}
            </option>
          ))}
        </SelectField>
        <SelectField label={C.day} value={day} onChange={setDay} hint={C.dayHint} busy={p.saving}>
          {Array.from({ length: 31 }, (_, i) => (
            <option key={i + 1} value={String(i + 1)} className="bg-surface text-text">
              {i + 1}
            </option>
          ))}
        </SelectField>
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <FieldLabel>{C.startsOn}</FieldLabel>
            <p className="text-body font-medium text-text">{fullDate(bill.startsOn)}</p>
          </div>
        ) : (
          <DateField
            label={C.startsOn}
            value={startsOn}
            onChange={(v) => {
              setStartsOn(v);
              setErrors((x) => ({ ...x, endsOn: undefined }));
            }}
            hint={pastStart ? C.startsOnPast(monthName(p.today.slice(0, 7))) : undefined}
            busy={p.saving}
          />
        )}
        <DateField
          label={C.endsOn}
          value={endsOn}
          onChange={(v) => {
            setEndsOn(v);
            setErrors((x) => ({ ...x, endsOn: undefined }));
          }}
          error={errors.endsOn}
          hint={C.endsOnHint}
          inputRef={endsRef}
          busy={p.saving}
        />
      </form>
      {galat === null ? null : (
        <Alert
          action={
            galat === 'network' || galat === 'server' ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void submit();
                }}
              >
                Coba lagi
              </Button>
            ) : galat === 'gone' || galat === 'archived' ? (
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
              : galat === 'gone'
                ? C.errBillGone
                : galat === 'archived'
                  ? C.errBillArchived
                  : C.errInvalid}
        </Alert>
      )}
      {editing ? (
        <Button
          variant="danger"
          size="sm"
          className="self-start"
          aria-disabled={p.saving || undefined}
          onClick={() => {
            if (!p.saving) p.onArchive();
          }}
        >
          <TrashIcon size={18} />
          {C.archive}
        </Button>
      ) : null}
    </>
  );
}

function NameField({
  value,
  onChange,
  error,
  inputRef,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | undefined;
  inputRef: React.RefObject<HTMLInputElement | null>;
  readOnly: boolean;
}) {
  const id = useId();
  const errorId = `${id}-e`;
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{C.name}</FieldLabel>
      <div className={`${fieldShell(error !== undefined)} px-3.5`}>
        <input
          id={id}
          ref={inputRef}
          type="text"
          value={value}
          maxLength={NAME_MAX + 20}
          autoComplete="off"
          aria-invalid={error !== undefined || undefined}
          aria-describedby={error === undefined ? undefined : errorId}
          aria-disabled={readOnly || undefined}
          onChange={(e) => {
            if (!readOnly) onChange(e.target.value);
          }}
          className="min-h-11 w-full min-w-0 bg-transparent text-body font-medium text-text outline-none"
        />
      </div>
      {error === undefined ? null : (
        <div role="alert">
          <FieldError id={errorId}>{error}</FieldError>
        </div>
      )}
    </div>
  );
}

export interface BillSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruang: Ruang;
  /** Tagihan yang diubah; `null` = tambah. */
  bill: BillListVM | null;
  accounts: readonly AccountVM[];
  categories: readonly CategoryVM[];
  today: IsoDate;
  wajibRoots: Readonly<Record<string, true>>;
  onCreate: (input: CreateBillSubmit) => Promise<BillResult>;
  onUpdate: (input: UpdateBillSubmit) => Promise<BillResult>;
  onArchive: (billId: string) => Promise<BillResult>;
  /** Sesudah simpan/arsip berhasil (Host memulihkan fokus ke baris). */
  onChanged?: ((billId: string | null) => void) | undefined;
  /** `not_found`/`bill_archived` (sheet basi): tutup sheet dan muat ulang halaman. */
  onReload: () => void;
}

/**
 * Sheet `Tambah tagihan` / `Ubah tagihan` (S9-TG2). Satu `clientId` per pembukaan (Tambah:
 * "Coba lagi" = replay, bukan tagihan kedua). Arsip lewat dialog (fokus awal `Kembali`); berhasil:
 * sheet menutup dan toast menyebut ruang (tanpa nominal).
 */
export function BillSheet(props: BillSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <BillSession key={session} {...props} />;
}

function BillSession({
  open,
  onOpenChange,
  ruang,
  bill,
  accounts,
  categories,
  today,
  wajibRoots,
  onCreate,
  onUpdate,
  onArchive,
  onChanged,
  onReload,
}: BillSheetProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  async function archive() {
    if (bill === null || archiveBusy) return;
    setArchiveBusy(true);
    setArchiveError(null);
    let res: BillResult;
    try {
      res = await onArchive(bill.billId);
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      setArchiveBusy(false);
    }
    if (res.ok) {
      setConfirm(false);
      toast({ message: C.archivedToast(bill.name, ruang) });
      onOpenChange(false);
      onChanged?.(null);
      return;
    }
    setArchiveError(
      res.code === 'network'
        ? C.errArchiveNetwork
        : res.code === 'not_found'
          ? C.errArchiveGone
          : res.code === 'bill_archived'
            ? C.errArchiveArchived
            : C.errArchiveServer,
    );
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!saving && !archiveBusy) onOpenChange(next);
        }}
        title={bill === null ? C.sheetTitle(ruang) : C.sheetEditTitle(ruang)}
        titleContent={
          <>
            {bill === null ? 'Tagihan' : 'Ubah tagihan'}
            <SpaceTag space={ruang} />
          </>
        }
        tint={ruang}
        initialFocus={bill === null ? nameRef : amountRef}
        footer={
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
              C.save
            )}
          </Button>
        }
      >
        <Form
          ruang={ruang}
          bill={bill}
          accounts={accounts}
          categories={categories}
          today={today}
          wajibRoots={wajibRoots}
          saving={saving}
          setSaving={setSaving}
          nameRef={nameRef}
          amountRef={amountRef}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onArchive={() => {
            setArchiveError(null);
            setConfirm(true);
          }}
          onReload={onReload}
          onDone={(name, billId) => {
            toast({ message: C.saved(name, ruang) });
            onOpenChange(false);
            onChanged?.(billId);
          }}
        />
      </Sheet>
      {bill === null ? null : (
        <ConfirmDialog
          open={confirm}
          onOpenChange={(next) => {
            if (!archiveBusy) setConfirm(next);
          }}
          icon={<TrashIcon size={22} />}
          title={C.archiveTitle(bill.name)}
          description={C.archiveBody}
          confirmLabel={C.archive}
          cancelLabel={C.back}
          holdOpen
          busy={archiveBusy}
          alert={archiveError}
          onConfirm={() => {
            void archive();
          }}
        />
      )}
    </>
  );
}
