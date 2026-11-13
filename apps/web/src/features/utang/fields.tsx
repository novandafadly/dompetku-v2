'use client';

import { shortDateLabel } from '@dompetku/domain';
import Link from 'next/link';
import { useId, type ReactNode, type RefObject } from 'react';
import { Button, buttonClass } from '@/components/ui/button';
import { FieldLabel, fieldShell } from '@/components/ui/field';
import { FieldError } from '@/components/ui/field-messages';
import { CircleNotchIcon } from '@/components/ui/icons/circle-notch';
import { InfoIcon } from '@/components/ui/icons/info';
import { UserPlusIcon } from '@/components/ui/icons/user-plus';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { WarningIcon } from '@/components/ui/icons/warning';
import { TextField } from '@/components/ui/text-field';
import { focusRing } from '@/components/ui/styles';
import { SelectField } from '@/components/ui/form-parts';
import { UTANG_COPY } from './copy';
import type { ContactVM } from './types';

/**
 * Bagian formulir bersama sheet Utang (Tambah, Ubah, Bayar): tanggal, kontak, tombol simpan,
 * kotak peringatan. Client Component (dimuat di chunk sheet, bukan di halaman).
 */

/** `<input type="date">` berlabel + teks pasti (pemilih tanggal browser memakai format lokal). */
export function DateInput({
  label,
  value,
  onChange,
  max,
  min,
  error,
  busy,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: string;
  min?: string;
  error?: string | undefined;
  busy: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  const errorId = `${id}-e`;
  const textId = `${id}-t`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className={`${fieldShell(error !== undefined)} px-3.5`}>
        <input
          id={id}
          ref={inputRef}
          type="date"
          value={value}
          min={min ?? '2020-01-01'}
          max={max}
          aria-invalid={error !== undefined || undefined}
          aria-describedby={error === undefined ? textId : `${textId} ${errorId}`}
          aria-disabled={busy || undefined}
          onChange={(e) => {
            if (!busy) onChange(e.target.value);
          }}
          className="min-h-11 w-full min-w-0 bg-transparent text-body font-medium text-text outline-none"
        />
      </div>
      <p id={textId} className="text-meta font-semibold text-text-soft">
        {value === '' ? 'Belum diisi' : `${shortDateLabel(value)} ${value.slice(0, 4)}`}
      </p>
      {error === undefined ? null : (
        <div role="alert">
          <FieldError id={errorId}>{error}</FieldError>
        </div>
      )}
    </div>
  );
}

/** Tombol footer sheet: spinner + `Menyimpan…`, `aria-disabled` (fokus tidak lepas). */
export function SaveButton({
  formId,
  saving,
  label,
}: {
  formId: string;
  saving: boolean;
  label: string;
}) {
  return (
    <Button
      type="submit"
      form={formId}
      aria-disabled={saving || undefined}
      aria-busy={saving || undefined}
      className="w-full aria-disabled:border-hairline aria-disabled:bg-surface-2 aria-disabled:text-text-muted aria-disabled:hover-pointer:bg-surface-2"
    >
      {saving ? (
        <>
          <CircleNotchIcon size={18} weight="bold" className="shrink-0 motion-safe:animate-spin" />
          Menyimpan…
        </>
      ) : (
        label
      )}
    </Button>
  );
}

/** Kotak `warning-tint` (bukan galat): saldo kurang, nominal dari data dompet. */
export function WarningBox({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p
      id={id}
      role="status"
      className="flex items-start gap-2 rounded-lg bg-warning-tint p-3 text-label font-semibold text-warning"
    >
      <WarningIcon size={18} weight="fill" className="mt-px shrink-0" />
      <span className="text-pretty">{children}</span>
    </p>
  );
}

/** Kotak statis `surface-2` dengan ikon `info`. */
export function InfoBox({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-surface-2 p-3 text-meta font-medium text-text-soft">
      <InfoIcon size={14} className="mt-0.5 shrink-0" />
      <span className="text-pretty">{children}</span>
    </p>
  );
}

/** Ruang tanpa dompet (S6-C6): teks + tautan Tambah dompet. */
export function NoAccountBlock({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-start gap-3 pb-1">
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-toast bg-accent-tint text-accent-text"
      >
        <WalletIcon size={24} />
      </span>
      <p className="text-body font-semibold text-text text-pretty">{text}</p>
      <Link href="/pribadi/dompet?tambah=1" className={buttonClass('primary', 'md', 'w-full')}>
        {UTANG_COPY.addAccount}
      </Link>
    </div>
  );
}

export interface ContactChoice {
  /** `pick`: pilih dari daftar; `new`: ketik nama (dibuat bersama utangnya). */
  mode: 'pick' | 'new';
  contactId: string;
  name: string;
}

/**
 * Kontak (AD1 butir 2): tanpa kontak aktif langsung kolom nama; selain itu `SelectField` plus
 * `Tambah kontak baru` yang MENUKAR pilihan dengan kolom nama (dan `Pilih dari daftar` menukar
 * kembali). Tanpa sheet kedua. `current` = kontak utang ini yang sudah diarsipkan (Ubah), agar
 * nilainya tetap terbaca.
 */
export function ContactControl({
  contacts,
  value,
  onChange,
  error,
  busy,
  selectRef,
  nameRef,
  current,
}: {
  contacts: readonly ContactVM[];
  value: ContactChoice;
  onChange: (v: ContactChoice) => void;
  error?: string | undefined;
  busy: boolean;
  selectRef?: RefObject<HTMLSelectElement | null>;
  nameRef?: RefObject<HTMLInputElement | null>;
  current?: { id: string; name: string } | undefined;
}) {
  const hasList = contacts.length > 0 || current !== undefined;
  if (!hasList || value.mode === 'new') {
    return (
      <div className="flex flex-col gap-1">
        <TextField
          label={UTANG_COPY.contactName}
          value={value.name}
          onChange={(v) => {
            onChange({ ...value, name: v });
          }}
          error={error}
          maxLength={60}
          readOnly={busy}
          {...(nameRef === undefined ? {} : { inputRef: nameRef })}
          autoComplete="off"
        />
        {hasList ? (
          <TextButton
            onClick={() => {
              onChange({ ...value, mode: 'pick' });
            }}
          >
            {UTANG_COPY.pickContact}
          </TextButton>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <SelectField
        label={UTANG_COPY.contactField}
        value={value.contactId}
        onChange={(v) => {
          onChange({ ...value, contactId: v });
        }}
        error={error}
        selectRef={selectRef}
        busy={busy}
      >
        <option value="" className="bg-surface text-text">
          Pilih kontak
        </option>
        {current !== undefined && !contacts.some((c) => c.contactId === current.id) ? (
          <option value={current.id} className="bg-surface text-text">
            {current.name} (diarsipkan)
          </option>
        ) : null}
        {contacts.map((c) => (
          <option key={c.contactId} value={c.contactId} className="bg-surface text-text">
            {c.name}
          </option>
        ))}
      </SelectField>
      <TextButton
        onClick={() => {
          onChange({ ...value, mode: 'new' });
        }}
      >
        <UserPlusIcon size={16} />
        {UTANG_COPY.newContact}
      </TextButton>
    </div>
  );
}

function TextButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-1.5 self-start rounded-md px-1 text-label font-bold text-accent-text hover-pointer:underline ${focusRing}`}
    >
      {children}
    </button>
  );
}
