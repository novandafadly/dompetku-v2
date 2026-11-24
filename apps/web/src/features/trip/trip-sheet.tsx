'use client';

import type { IsoDate, Rupiah } from '@dompetku/domain';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { FieldError } from '@/components/ui/field-messages';
import { Alert } from '@/components/ui/form-parts';
import { InfoIcon } from '@/components/ui/icons/info';
import { MoneyInput } from '@/components/ui/money-input';
import { SaveButton } from '@/components/ui/save-button';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { focusRing } from '@/components/ui/styles';
import { TextField } from '@/components/ui/text-field';
import { newClientId } from '@/features/ledger/client-id';
import type { TripOverviewVM, TripVM } from '@/features/ledger/trip-types';
import type { LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { TRIP_COPY as C } from './copy';
import {
  FIELD_BUDGET,
  FIELD_ENDS_ON_BEFORE,
  FIELD_ENDS_ON_EMPTY,
  FIELD_ENDS_ON_SERVER,
  FIELD_ENDS_ON_TOO_LONG,
  FIELD_NAME,
  FIELD_STARTS_ON,
  nameTakenText,
  tripFailedText,
} from './galat';
import { tripDaysDiff } from './present';

const FORM_ID = 'trip-form';
const NAME_MAX = 60;
const MAX_BUDGET = 10 ** 13;
const MIN_DATE = '2000-01-01';
const MAX_DATE = '2100-12-31';

export type EditableTrip = Pick<
  TripVM | TripOverviewVM,
  'id' | 'name' | 'startsOn' | 'endsOn' | 'budget'
>;

export interface CreateTripSubmit {
  clientId: string;
  name: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  budget?: Rupiah | null;
}

export interface UpdateTripSubmit {
  tripId: string;
  name: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  budget: Rupiah | null;
}

export type TripSaveResult =
  { ok: true; tripId: string } | { ok: false; code: LedgerErrorCode; field?: string };

export interface TripSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruang: Ruang;
  today: IsoDate;
  /** `null` = Tambah trip; terisi = Ubah trip itu. */
  trip: EditableTrip | null;
  /** Fokus awal: `'budget'` saat dibuka dari `Tambah anggaran trip` (TR6/TR12). */
  initialFocusField?: 'name' | 'budget' | undefined;
  onCreate: (input: CreateTripSubmit) => Promise<TripSaveResult>;
  onUpdate: (input: UpdateTripSubmit) => Promise<TripSaveResult>;
  onSaved: (info: { tripId: string; name: string; created: boolean }) => void;
}

interface Errors {
  name?: string | undefined;
  startsOn?: string | undefined;
  endsOn?: string | undefined;
  budget?: string | undefined;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(v: string): boolean {
  if (!ISO_DATE_RE.test(v)) return false;
  if (v < MIN_DATE || v > MAX_DATE) return false;
  const y = Number(v.slice(0, 4));
  const m = Number(v.slice(5, 7));
  const d = Number(v.slice(8, 10));
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * Sheet `Tambah trip · {Ruang}` dan `Ubah trip · {Ruang}` (S15-TR11, TR12).
 * Satu `clientId` lahir per pembukaan sheet: klik ganda dan `Coba lagi` memakai permintaan yang
 * sama. Dua `DateInput` bersusun 1 kolom di bawah 360 px.
 */
export function TripSheet(props: TripSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <TripSession key={session} {...props} />;
}

function TripSession({
  open,
  onOpenChange,
  ruang,
  today,
  trip,
  initialFocusField = 'name',
  onCreate,
  onUpdate,
  onSaved,
}: TripSheetProps) {
  const editing = trip !== null;
  const [clientId] = useState(newClientId);
  const [name, setName] = useState(trip?.name ?? '');
  const [startsOn, setStartsOn] = useState<string>(trip?.startsOn ?? today);
  const [endsOn, setEndsOn] = useState<string>(trip?.endsOn ?? '');
  const [budget, setBudget] = useState<Rupiah | null>(trip?.budget ?? null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [galat, setGalat] = useState<{ text: string; retry: boolean } | null>(null);
  const busy = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const startsRef = useRef<HTMLInputElement>(null);
  const endsRef = useRef<HTMLInputElement>(null);
  const budgetRef = useRef<HTMLInputElement>(null);
  const budgetErrId = useId();
  const budgetHintId = useId();

  function clear(key?: keyof Errors) {
    if (key !== undefined) setErrors((e) => ({ ...e, [key]: undefined }));
    setGalat(null);
  }

  async function save() {
    if (busy.current) return;
    const trimmed = name.trim();
    const next: Errors = {};
    if (trimmed.length < 1 || trimmed.length > NAME_MAX) next.name = FIELD_NAME;
    const startValid = validDate(startsOn);
    if (!startValid) next.startsOn = FIELD_STARTS_ON;
    if (endsOn === '') {
      next.endsOn = FIELD_ENDS_ON_EMPTY;
    } else if (!validDate(endsOn)) {
      next.endsOn = FIELD_ENDS_ON_SERVER;
    } else if (startValid) {
      const diff = tripDaysDiff(startsOn, endsOn);
      if (diff < 0) next.endsOn = FIELD_ENDS_ON_BEFORE;
      else if (diff > 365) next.endsOn = FIELD_ENDS_ON_TOO_LONG;
    }
    if (budget !== null && (budget <= 0 || budget > MAX_BUDGET)) {
      next.budget = FIELD_BUDGET;
    }
    setErrors(next);
    setGalat(null);
    if (next.name !== undefined) return nameRef.current?.focus();
    if (next.startsOn !== undefined) return startsRef.current?.focus();
    if (next.endsOn !== undefined) return endsRef.current?.focus();
    if (next.budget !== undefined) return budgetRef.current?.focus();

    if (
      trip !== null &&
      trimmed === trip.name &&
      startsOn === trip.startsOn &&
      endsOn === trip.endsOn &&
      budget === trip.budget
    ) {
      // Tanpa perubahan: tutup tanpa toast dan tanpa memanggil server (TR12).
      onOpenChange(false);
      return;
    }

    busy.current = true;
    setSaving(true);
    let res: TripSaveResult;
    try {
      res =
        trip === null
          ? await onCreate({
              clientId,
              name: trimmed,
              startsOn,
              endsOn,
              ...(budget === null ? {} : { budget }),
            })
          : await onUpdate({
              tripId: trip.id,
              name: trimmed,
              startsOn,
              endsOn,
              budget,
            });
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
      setSaving(false);
    }

    if (res.ok) {
      onSaved({ tripId: res.tripId, name: trimmed, created: trip === null });
      return;
    }

    switch (res.code) {
      case 'name_taken':
        setErrors({ name: nameTakenText(trimmed, ruang) });
        nameRef.current?.focus();
        break;
      case 'invalid': {
        // Petakan kedua ejaan field: Zod (`startsOn`, `endsOn`, `budget`) dan DB (`starts_on`, `ends_on`, `budget_amount`).
        const field = res.field ?? '';
        if (field === 'name') {
          setErrors({ name: FIELD_NAME });
          nameRef.current?.focus();
        } else if (field === 'startsOn' || field === 'starts_on') {
          setErrors({ startsOn: FIELD_STARTS_ON });
          startsRef.current?.focus();
        } else if (field === 'endsOn' || field === 'ends_on') {
          setErrors({ endsOn: FIELD_ENDS_ON_SERVER });
          endsRef.current?.focus();
        } else if (field === 'budget' || field === 'budget_amount') {
          setErrors({ budget: FIELD_BUDGET });
          budgetRef.current?.focus();
        } else {
          setGalat({ text: tripFailedText('unknown'), retry: true });
        }
        break;
      }
      case 'network':
      case 'unknown':
        setGalat({ text: tripFailedText(res.code), retry: true });
        break;
      default:
        setGalat({ text: tripFailedText(res.code, trimmed, ruang), retry: false });
    }
  }

  const left = NAME_MAX - name.length;
  const nameHint = name.length >= 50 ? `${C.nameLeft(left)} ${C.nameHint}` : C.nameHint;
  const baseTitle = editing ? C.editTitle : C.addTitle;
  const budgetDescribedBy =
    errors.budget === undefined ? budgetHintId : `${budgetHintId} ${budgetErrId}`;

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
      initialFocus={initialFocusField === 'budget' ? budgetRef : nameRef}
      footer={
        <SaveButton formId={FORM_ID} saving={saving} label={editing ? C.saveChanges : C.save} />
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
        <div className="grid grid-cols-1 gap-3 narrow:grid-cols-2">
          <DateInput
            label={C.startsOnField}
            value={startsOn}
            onChange={(v) => {
              setStartsOn(v);
              clear('startsOn');
              if (errors.endsOn !== undefined) clear('endsOn');
            }}
            min={MIN_DATE}
            max={MAX_DATE}
            error={errors.startsOn}
            busy={saving}
            inputRef={startsRef}
          />
          <DateInput
            label={C.endsOnField}
            value={endsOn}
            onChange={(v) => {
              setEndsOn(v);
              clear('endsOn');
            }}
            min={MIN_DATE}
            max={MAX_DATE}
            error={errors.endsOn}
            busy={saving}
            inputRef={endsRef}
          />
        </div>
        {editing ? (
          <p className="flex items-start gap-1.5 text-caption font-medium text-text-muted">
            <InfoIcon size={14} className="mt-0.5 shrink-0" />
            <span className="text-pretty">{C.editDatesNote}</span>
          </p>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <MoneyInput
            label={C.budgetField}
            value={budget}
            onChange={(v) => {
              setBudget(v);
              clear('budget');
            }}
            readOnly={saving}
            inputRef={budgetRef}
            describedBy={budgetDescribedBy}
          />
          <p id={budgetHintId} className="text-caption font-medium text-text-muted">
            {C.budgetSheetHint}
          </p>
          {editing && budget !== null ? (
            <button
              type="button"
              aria-disabled={saving || undefined}
              onClick={() => {
                if (saving) return;
                setBudget(null);
                clear('budget');
              }}
              className={`inline-flex min-h-11 items-center self-start rounded-md px-1 text-label font-bold text-accent-text hover-pointer:underline ${focusRing}`}
            >
              {C.clearBudget}
            </button>
          ) : null}
          {errors.budget === undefined ? null : (
            <div role="alert">
              <FieldError id={budgetErrId}>{errors.budget}</FieldError>
            </div>
          )}
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
