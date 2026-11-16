'use client';

import type { IsoDate, Rupiah } from '@dompetku/domain';
import { useId, useRef, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { Button } from '@/components/ui/button';
import { Alert, SelectField } from '@/components/ui/form-parts';
import { MoneyInput } from '@/components/ui/money-input';
import { SaveButton } from '@/components/ui/save-button';
import { FieldHint } from '@/components/ui/field-messages';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { TextField } from '@/components/ui/text-field';
import { newClientId } from '@/features/ledger/client-id';
import type { AssetKind, LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { ASET_COPY as C, ASSET_KIND_LABEL, ASSET_KINDS } from './copy';
import {
  assetFailedText,
  FIELD_DATE,
  FIELD_KIND,
  FIELD_NAME,
  FIELD_VALUE,
  nameTaken,
} from './galat';

const FORM_ID = 'tambah-aset';
const NAME_MAX = 60;
const MAX_VALUE = 10 ** 13;
const RUANG_NAME: Record<Ruang, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };

export interface AddAssetSubmit {
  clientId: string;
  name: string;
  assetKind: AssetKind;
  /** Nilai sekarang; 0 = tanpa entri Nilai awal (jenis Saham selalu 0). */
  openingBalance: Rupiah;
  openedOn?: IsoDate;
}
export type AddAssetResult =
  { ok: true; accountId: string } | { ok: false; code: LedgerErrorCode; field?: string };

export interface AddAssetSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruang: Ruang;
  today: IsoDate;
  /** Nama dompet/aset yang sudah ada di ruang ini (nama unik per ruang). */
  existingNames: readonly string[];
  onSubmit: (input: AddAssetSubmit) => Promise<AddAssetResult>;
  /** Sesudah tersimpan (sheet sudah menutup): toast dan, untuk Saham, ke Detail dompet saham. */
  onSaved: (info: { accountId: string; name: string; assetKind: AssetKind }) => void;
}

interface Errors {
  kind?: string | undefined;
  name?: string | undefined;
  value?: string | undefined;
  date?: string | undefined;
}

/**
 * Sheet `Tambah aset` (S14-AS2). Satu `clientId` per pembukaan (klik ganda/`Coba lagi` = replay).
 * Jenis `Saham` hanya di Pribadi dan tanpa nilai awal (diisi lewat Beli saham, Task 10); nilai
 * sekarang opsional untuk jenis lain, dicatat DB sebagai `Nilai awal`.
 */
export function AddAssetSheet(props: AddAssetSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <AddAssetSession key={session} {...props} />;
}

function AddAssetSession({
  open,
  onOpenChange,
  ruang,
  today,
  existingNames,
  onSubmit,
  onSaved,
}: AddAssetSheetProps) {
  const [clientId] = useState(newClientId);
  const [kind, setKind] = useState<AssetKind | ''>('');
  const [name, setName] = useState('');
  const [value, setValue] = useState<Rupiah | null>(null);
  const [since, setSince] = useState<string>(today);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [galat, setGalat] = useState<{ text: string; retry: boolean } | null>(null);
  const busy = useRef(false);
  const kindRef = useRef<HTMLSelectElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const valueHintId = useId();

  const kinds = ASSET_KINDS.filter((k) => ruang === 'pribadi' || k !== 'saham');
  const isStock = kind === 'saham';
  const hasValue = !isStock && value !== null && value > 0;

  function clear(key?: keyof Errors) {
    if (key !== undefined) setErrors((e) => ({ ...e, [key]: undefined }));
    setGalat(null);
  }

  async function save() {
    if (busy.current) return;
    const trimmed = name.trim();
    const next: Errors = {};
    if (kind === '') next.kind = FIELD_KIND;
    if (trimmed.length < 1 || trimmed.length > NAME_MAX) next.name = FIELD_NAME;
    else if (existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      next.name = nameTaken(trimmed, RUANG_NAME[ruang]);
    }
    if (!isStock && value !== null && (value < 0 || value > MAX_VALUE)) next.value = FIELD_VALUE;
    if (hasValue && since > today) next.date = FIELD_DATE;
    setErrors(next);
    setGalat(null);
    if (next.kind !== undefined || kind === '') return kindRef.current?.focus();
    if (next.name !== undefined) return nameRef.current?.focus();
    if (next.value !== undefined) return valueRef.current?.focus();
    if (next.date !== undefined) return dateRef.current?.focus();

    busy.current = true;
    setSaving(true);
    let res: AddAssetResult;
    try {
      res = await onSubmit({
        clientId,
        name: trimmed,
        assetKind: kind,
        openingBalance: isStock ? 0 : (value ?? 0),
        ...(hasValue ? { openedOn: since } : {}),
      });
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (res.ok) {
      onSaved({ accountId: res.accountId, name: trimmed, assetKind: kind });
      return;
    }
    switch (res.code) {
      case 'name_taken':
        setErrors({ name: nameTaken(trimmed, RUANG_NAME[ruang]) });
        nameRef.current?.focus();
        break;
      case 'pocket_personal_only':
        setErrors({ kind: assetFailedText('pocket_personal_only') });
        kindRef.current?.focus();
        break;
      case 'invalid': {
        const field = res.field ?? '';
        if (field.includes('asset_kind')) {
          setErrors({ kind: FIELD_KIND });
          kindRef.current?.focus();
        } else if (field.includes('name')) {
          setErrors({ name: FIELD_NAME });
          nameRef.current?.focus();
        } else if (field.includes('opening') || field.includes('value')) {
          setErrors({ value: FIELD_VALUE });
          valueRef.current?.focus();
        } else if (field === 'on' || field.includes('opened')) {
          setErrors({ date: FIELD_DATE });
          dateRef.current?.focus();
        } else {
          setGalat({ text: assetFailedText('unknown'), retry: true });
        }
        break;
      }
      case 'network':
      case 'unknown':
        setGalat({ text: assetFailedText(res.code), retry: true });
        break;
      default:
        setGalat({ text: assetFailedText(res.code), retry: false });
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // Esc/overlay/Tutup tidak menutup selama menyimpan.
        if (!saving) onOpenChange(next);
      }}
      title={C.addTitle(ruang)}
      titleContent={
        <>
          {C.add}
          <SpaceTag space={ruang} />
        </>
      }
      tint={ruang}
      initialFocus={kindRef}
      footer={<SaveButton formId={FORM_ID} saving={saving} label={C.save} />}
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
        <SelectField
          label={C.kindField}
          value={kind}
          onChange={(v) => {
            const k = kinds.find((x) => x === v);
            setKind(k ?? '');
            clear('kind');
          }}
          error={errors.kind}
          hint={C.kindHint}
          selectRef={kindRef}
          busy={saving}
        >
          <option value="" className="bg-surface text-text">
            {C.kindPlaceholder}
          </option>
          {kinds.map((k) => (
            <option key={k} value={k} className="bg-surface text-text">
              {ASSET_KIND_LABEL[k]}
            </option>
          ))}
        </SelectField>
        <TextField
          label={C.nameField}
          value={name}
          onChange={(v) => {
            setName(v);
            clear('name');
          }}
          error={errors.name}
          hint={C.nameHint(kind)}
          maxLength={NAME_MAX}
          readOnly={saving}
          autoComplete="off"
          inputRef={nameRef}
        />
        {isStock ? (
          <FieldHint id={valueHintId}>{C.valueHintStock}</FieldHint>
        ) : (
          <div className="flex flex-col gap-1.5">
            <MoneyInput
              label={C.valueField}
              optional
              value={value}
              onChange={(v) => {
                setValue(v);
                clear('value');
              }}
              readOnly={saving}
              inputRef={valueRef}
              describedBy={valueHintId}
            />
            <FieldHint id={valueHintId}>{C.valueHint}</FieldHint>
            {errors.value === undefined ? null : (
              <p role="alert" className="text-meta font-semibold text-danger">
                {errors.value}
              </p>
            )}
          </div>
        )}
        {hasValue ? (
          <DateInput
            label={C.sinceField}
            value={since}
            onChange={(v) => {
              setSince(v);
              clear('date');
            }}
            max={today}
            error={errors.date}
            busy={saving}
            inputRef={dateRef}
          />
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
