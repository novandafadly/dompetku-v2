'use client';

import { formatRupiah, type Rupiah } from '@dompetku/domain';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FieldLabel } from '@/components/ui/field';
import { FieldError, FieldHint } from '@/components/ui/field-messages';
import { CheckIcon } from '@/components/ui/icons/check';
import { CaretDownIcon } from '@/components/ui/icons/caret-down';
import { CircleNotchIcon } from '@/components/ui/icons/circle-notch';
import { TrashIcon } from '@/components/ui/icons/trash';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { MoneyInput } from '@/components/ui/money-input';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { focusRing } from '@/components/ui/styles';
import { toast } from '@/components/ui/toast';
import type { LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { categoryArchivedBudgetText, obligationDoubleBudgetText, RENCANA_COPY } from './copy';
import type { BudgetOverviewVM } from './types';

const FORM_ID = 'atur-anggaran';

export interface BudgetSubmit {
  categoryId: string;
  amount: Rupiah;
  wajib: boolean;
}

/** Hasil Server Action yang diteruskan pulau klien; galat jaringan sudah dipetakan jadi `network`. */
export type BudgetResult = { ok: true } | { ok: false; code: LedgerErrorCode; field?: string };

type Galat = 'network' | 'server' | 'gone' | 'invalid';

interface FieldErrors {
  category?: string | undefined;
  amount?: string | undefined;
  wajib?: string | undefined;
}

function Alert({ children, action }: { children: string; action?: React.ReactNode }) {
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

/** Sakelar `Wajib`: status terlihat (teks Ya/Tidak) selain `aria-checked`, bukan warna saja. */
function WajibSwitch({
  checked,
  onChange,
  hintId,
  errorId,
  invalid,
  buttonRef,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  hintId: string;
  errorId: string | undefined;
  invalid: boolean;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  disabled: boolean;
}) {
  const labelId = useId();
  return (
    <button
      ref={buttonRef}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={errorId === undefined ? hintId : `${hintId} ${errorId}`}
      aria-invalid={invalid || undefined}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-2 text-left ${focusRing} ${
        invalid ? 'border-2 border-danger' : 'border-border'
      } bg-bg hover-pointer:bg-hover aria-disabled:text-text-muted`}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span id={labelId} className="text-body/tight font-semibold text-text">
          {RENCANA_COPY.wajib}
        </span>
        <span id={hintId} className="text-caption font-medium text-text-muted">
          {RENCANA_COPY.wajibHint}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`inline-flex min-h-8 shrink-0 items-center rounded-lg border px-2.5 text-meta font-bold ${
          checked
            ? 'border-accent-text bg-accent-tint text-accent-text'
            : 'border-hairline bg-surface-2 text-text-soft'
        }`}
      >
        {checked ? (
          <>
            <CheckIcon size={14} weight="bold" className="mr-1 shrink-0" />
            Ya
          </>
        ) : (
          'Tidak'
        )}
      </span>
    </button>
  );
}

function Form({
  rows,
  editing,
  initialCategoryId,
  range,
  previous,
  billNameByRoot,
  onSubmit,
  onRemove,
  categoryRef,
  amountRef,
  saving,
  setSaving,
  onDone,
}: {
  saving: boolean;
  setSaving: (saving: boolean) => void;
  rows: readonly BudgetOverviewVM[];
  editing: BudgetOverviewVM | null;
  initialCategoryId: string | null;
  range: string;
  previous: Readonly<Record<string, Rupiah>>;
  billNameByRoot: Readonly<Record<string, string>>;
  onSubmit: (input: BudgetSubmit) => Promise<BudgetResult>;
  onRemove: () => void;
  categoryRef: React.RefObject<HTMLSelectElement | null>;
  amountRef: React.RefObject<HTMLInputElement | null>;
  onDone: (row: BudgetOverviewVM) => void;
}) {
  const options = rows.filter((r) => r.budget === null && !r.archived);
  const [categoryId, setCategoryId] = useState(
    editing?.categoryId ??
      (initialCategoryId !== null && options.some((o) => o.categoryId === initialCategoryId)
        ? initialCategoryId
        : ''),
  );
  const [amount, setAmount] = useState<Rupiah | null>(editing?.budget ?? null);
  const [wajib, setWajib] = useState(editing?.wajib ?? false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [galat, setGalat] = useState<Galat | null>(null);
  const busy = useRef(false);
  const wajibRef = useRef<HTMLButtonElement>(null);
  const categoryId_ = useId();
  const categoryErrorId = useId();
  const amountHintId = useId();
  const amountErrorId = useId();
  const wajibErrorId = useId();
  const wajibHintId = useId();
  const archived = editing?.archived === true;
  const chosen = rows.find((r) => r.categoryId === categoryId) ?? null;
  const prev = chosen === null ? undefined : previous[chosen.categoryId];
  const noOptions = editing === null && options.length === 0;

  async function submit() {
    if (busy.current || archived) return;
    const next: FieldErrors = {};
    if (categoryId === '') next.category = RENCANA_COPY.errCategory;
    if (amount === null || amount <= 0) next.amount = RENCANA_COPY.errAmount;
    setErrors(next);
    setGalat(null);
    if (next.category !== undefined) {
      categoryRef.current?.focus();
      return;
    }
    if (next.amount !== undefined || amount === null) {
      amountRef.current?.focus();
      return;
    }
    busy.current = true;
    setSaving(true);
    let res: BudgetResult;
    try {
      res = await onSubmit({ categoryId, amount, wajib });
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (res.ok) {
      if (chosen !== null) onDone(chosen);
      return;
    }
    switch (res.code) {
      case 'obligation_double':
        setErrors({
          wajib: obligationDoubleBudgetText(billNameByRoot[categoryId]),
        });
        wajibRef.current?.focus();
        break;
      case 'category_archived':
        setErrors({ category: categoryArchivedBudgetText(chosen?.name ?? 'Kategori ini') });
        categoryRef.current?.focus();
        break;
      case 'category_not_root':
        setErrors({ category: RENCANA_COPY.errNotRoot });
        categoryRef.current?.focus();
        break;
      case 'invalid': {
        const f = res.field ?? '';
        if (f.includes('amount')) {
          setErrors({ amount: RENCANA_COPY.errAmount });
          amountRef.current?.focus();
        } else if (f.includes('categor')) {
          setErrors({ category: RENCANA_COPY.errCategory });
          categoryRef.current?.focus();
        } else {
          setGalat('invalid');
        }
        break;
      }
      case 'not_found':
        setGalat('gone');
        break;
      case 'network':
        setGalat('network');
        break;
      default:
        setGalat('server');
    }
  }

  const categoryDescribedBy = errors.category === undefined ? undefined : categoryErrorId;
  const amountDescribedBy = [amountHintId, errors.amount === undefined ? null : amountErrorId]
    .filter((x) => x !== null)
    .join(' ');

  return (
    <>
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={categoryId_}>{RENCANA_COPY.category}</FieldLabel>
          {editing === null ? (
            <div className="relative">
              <select
                id={categoryId_}
                ref={categoryRef}
                value={categoryId}
                disabled={noOptions}
                aria-invalid={errors.category !== undefined || undefined}
                aria-describedby={categoryDescribedBy}
                aria-disabled={saving || undefined}
                onChange={(e) => {
                  if (saving) return;
                  setCategoryId(e.target.value);
                  setErrors((x) => ({ ...x, category: undefined }));
                }}
                className="h-12 w-full min-w-0 appearance-none truncate rounded-lg border border-border bg-bg pr-9 pl-3.5 text-body font-medium text-text hover-pointer:bg-hover disabled:border-hairline disabled:text-text-muted aria-invalid:border-2 aria-invalid:border-danger"
              >
                <option value="">
                  {noOptions ? RENCANA_COPY.allBudgeted : RENCANA_COPY.pickCategory}
                </option>
                {options.map((o) => (
                  <option key={o.categoryId} value={o.categoryId} className="bg-surface text-text">
                    {o.name}
                  </option>
                ))}
              </select>
              <CaretDownIcon
                size={16}
                weight="bold"
                className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-text-soft"
              />
            </div>
          ) : (
            <p
              id={categoryId_}
              className="flex min-h-12 items-center rounded-lg border border-hairline bg-surface-2 px-3.5 text-body font-semibold text-text"
            >
              <span className="truncate">{editing.name}</span>
            </p>
          )}
          {errors.category === undefined ? null : (
            <div role="alert">
              <FieldError id={categoryErrorId}>{errors.category}</FieldError>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <MoneyInput
            label={RENCANA_COPY.amount}
            value={amount}
            onChange={(v) => {
              setAmount(v);
              setErrors((x) => ({ ...x, amount: undefined }));
            }}
            readOnly={saving || archived}
            inputRef={amountRef}
            describedBy={amountDescribedBy}
          />
          <FieldHint id={amountHintId}>
            {range}
            {prev === undefined ? '' : ` · Periode lalu: ${formatRupiah(prev)}`}
          </FieldHint>
          {errors.amount === undefined ? null : (
            <div role="alert">
              <FieldError id={amountErrorId}>{errors.amount}</FieldError>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5 pb-2">
          <WajibSwitch
            checked={wajib}
            onChange={(v) => {
              setWajib(v);
              setErrors((x) => ({ ...x, wajib: undefined }));
            }}
            hintId={wajibHintId}
            errorId={errors.wajib === undefined ? undefined : wajibErrorId}
            invalid={errors.wajib !== undefined}
            buttonRef={wajibRef}
            disabled={saving || archived}
          />
          {errors.wajib === undefined ? null : (
            <div role="alert">
              <FieldError id={wajibErrorId}>{errors.wajib}</FieldError>
            </div>
          )}
        </div>
      </form>
      {archived ? (
        <p className="text-label font-medium text-text-soft">{RENCANA_COPY.archivedNote}</p>
      ) : null}
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
            ) : undefined
          }
        >
          {galat === 'network'
            ? RENCANA_COPY.errNetwork
            : galat === 'server'
              ? RENCANA_COPY.errServer
              : galat === 'gone'
                ? RENCANA_COPY.errGone
                : RENCANA_COPY.errInvalid}
        </Alert>
      )}
      {editing === null ? null : (
        <Button
          variant="danger"
          size="sm"
          className="self-start"
          aria-disabled={saving || undefined}
          onClick={() => {
            if (!saving) onRemove();
          }}
        >
          <TrashIcon size={18} />
          {RENCANA_COPY.remove}
        </Button>
      )}
    </>
  );
}

/**
 * Sheet `Atur anggaran` (S9-AN2): membuat, mengubah, atau menghapus satu anggaran kategori induk.
 * `Kategori` hanya memilih induk pengeluaran aktif tanpa anggaran (K5); saat mengubah, kategorinya
 * terkunci. Menyimpan = upsert idempoten, jadi "Coba lagi" aman. Menghapus lewat dialog konfirmasi
 * (fokus awal `Kembali`). Berhasil: sheet menutup dan toast menyebut ruang (tanpa nominal).
 */
export function BudgetSheet({
  open,
  onOpenChange,
  ruang,
  rows,
  categoryId,
  range,
  previous,
  billNameByRoot,
  onSubmit,
  onDelete,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruang: Ruang;
  /** Semua kategori induk pengeluaran (`budget_overview`). */
  rows: readonly BudgetOverviewVM[];
  /** Kategori yang dibuka dari baris; `null` = sheet kosong. */
  categoryId: string | null;
  /** `23 Okt – 24 Nov`. */
  range: string;
  /** categoryId → anggaran periode lalu (keterangan di bawah Nominal). */
  previous: Readonly<Record<string, Rupiah>>;
  /** rootCategoryId → nama tagihan aktif (salinan `obligation_double`). */
  billNameByRoot: Readonly<Record<string, string>>;
  onSubmit: (input: BudgetSubmit) => Promise<BudgetResult>;
  /** `ok: false` memunculkan galat di dialog; `network` memberi saran Coba lagi. */
  onDelete: (categoryId: string) => Promise<BudgetResult>;
  /** Sesudah simpan/hapus berhasil: kategorinya (Host memulihkan fokus dan membersihkan catatan). */
  onChanged?: ((categoryId: string) => void) | undefined;
}) {
  const categoryRef = useRef<HTMLSelectElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const editing =
    categoryId === null
      ? null
      : (rows.find((r) => r.categoryId === categoryId && r.budget !== null) ?? null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function remove() {
    if (editing === null || removeBusy) return;
    setRemoveBusy(true);
    setRemoveError(null);
    let res: BudgetResult;
    try {
      res = await onDelete(editing.categoryId);
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      setRemoveBusy(false);
    }
    if (res.ok) {
      setConfirm(false);
      toast({ message: RENCANA_COPY.removed(editing.name, ruang) });
      onOpenChange(false);
      onChanged?.(editing.categoryId);
      return;
    }
    setRemoveError(
      res.code === 'network' ? RENCANA_COPY.errRemoveNetwork : RENCANA_COPY.errRemoveServer,
    );
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          // Esc/overlay/Tutup tidak menutup selama menyimpan.
          if (!saving && !removeBusy) onOpenChange(next);
        }}
        title={RENCANA_COPY.sheetTitle(ruang)}
        titleContent={
          <>
            Anggaran
            <SpaceTag space={ruang} />
          </>
        }
        tint={ruang}
        initialFocus={
          editing === null && rows.some((r) => r.budget === null && !r.archived)
            ? categoryRef
            : amountRef
        }
        footer={
          editing?.archived === true ? undefined : (
            <Button
              type="submit"
              form={FORM_ID}
              // Tidak pernah `disabled`: fokus tidak jatuh ke <body>; submit dijaga di formulir.
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
                RENCANA_COPY.save
              )}
            </Button>
          )
        }
      >
        <Form
          saving={saving}
          setSaving={setSaving}
          rows={rows}
          editing={editing}
          initialCategoryId={categoryId}
          range={range}
          previous={previous}
          billNameByRoot={billNameByRoot}
          categoryRef={categoryRef}
          amountRef={amountRef}
          onSubmit={onSubmit}
          onRemove={() => {
            setRemoveError(null);
            setConfirm(true);
          }}
          onDone={(row) => {
            toast({ message: RENCANA_COPY.saved(row.name, ruang) });
            onOpenChange(false);
            onChanged?.(row.categoryId);
          }}
        />
      </Sheet>
      {editing === null ? null : (
        <ConfirmDialog
          open={confirm}
          onOpenChange={(next) => {
            if (!removeBusy) setConfirm(next);
          }}
          icon={<TrashIcon size={22} />}
          title={RENCANA_COPY.removeTitle(editing.name)}
          description={RENCANA_COPY.removeBody}
          confirmLabel={RENCANA_COPY.remove}
          cancelLabel={RENCANA_COPY.back}
          holdOpen
          busy={removeBusy}
          alert={removeError}
          onConfirm={() => {
            void remove();
          }}
        />
      )}
    </>
  );
}
