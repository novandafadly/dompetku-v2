'use client';

import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ArchiveIcon } from '@/components/ui/icons/archive';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { TextField } from '@/components/ui/text-field';
import { focusRing } from '@/components/ui/styles';
import { newClientId } from '@/features/ledger/client-id';
import type { LedgerErrorCode } from '@/features/ledger/types';
import { Alert } from '@/features/rencana/form-parts';
import { UTANG_COPY as C, sheetTitle } from './copy';
import { SaveButton } from './fields';
import { utangFailedText } from './galat';
import type { ContactVM } from './types';

const FORM_ID = 'kontak';
const NAME_MAX = 60;

export type ContactMode = { kind: 'add' } | { kind: 'edit'; contact: ContactVM };

export interface ContactSubmit {
  /** Kunci pembuatan (stabil per pembukaan: `Coba lagi` tidak menggandakan kontak). */
  clientId: string;
  name: string;
}
export type ContactResult = { ok: true } | { ok: false; code: LedgerErrorCode; field?: string };

export interface ContactSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ContactMode;
  onSubmit: (input: ContactSubmit) => Promise<ContactResult>;
  /** `Arsipkan kontak` (hanya mode ubah): pemanggil menutup sheet lalu membuka dialog arsip. */
  onArchive: () => void;
}

/**
 * Sheet `Tambah kontak` / `Ubah kontak` (S11-KT2). Mengubah: nama baru berlaku di semua utang
 * kontak itu; ringkasan statis jumlah utang aktif (bukan uang).
 */
export function ContactSheet(props: ContactSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <ContactSession key={session} {...props} />;
}

function ContactSession({ open, onOpenChange, mode, onSubmit, onArchive }: ContactSheetProps) {
  const edit = mode.kind === 'edit';
  const [clientId] = useState(newClientId);
  const [name, setName] = useState(mode.kind === 'edit' ? mode.contact.name : '');
  const [error, setError] = useState<string | undefined>();
  const [galat, setGalat] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const title = edit ? C.editContact : C.addContact;

  async function save() {
    if (busy.current) return;
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > NAME_MAX) {
      setError(C.errContactName);
      nameRef.current?.focus();
      return;
    }
    setError(undefined);
    setGalat(null);
    busy.current = true;
    setSaving(true);
    let res: ContactResult;
    try {
      res = await onSubmit({ clientId, name: trimmed });
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (res.ok) return;
    if (res.code === 'contact_name_taken') {
      setError('Sudah ada kontak dengan nama ini.');
      nameRef.current?.focus();
    } else if (res.code === 'invalid') {
      setError(C.errContactName);
      nameRef.current?.focus();
    } else {
      setGalat(utangFailedText(res.code));
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
      title={sheetTitle(title)}
      titleContent={
        <>
          {title}
          <SpaceTag space="pribadi" />
        </>
      }
      tint="pribadi"
      initialFocus={nameRef}
      footer={
        <>
          <SaveButton formId={FORM_ID} saving={saving} label="Simpan" />
          {edit ? (
            <button
              type="button"
              onClick={onArchive}
              aria-disabled={saving || undefined}
              className={`inline-flex min-h-11 w-full items-center justify-center rounded-lg px-3 text-label font-bold text-text-soft hover-pointer:bg-hover ${focusRing}`}
            >
              {C.archiveContact}
            </button>
          ) : null}
        </>
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
            setError(undefined);
          }}
          error={error}
          maxLength={NAME_MAX}
          readOnly={saving}
          inputRef={nameRef}
          autoComplete="off"
          {...(edit ? { hint: C.renameHint } : {})}
        />
      </form>
      {mode.kind === 'edit' ? (
        <p id={hintId} className="text-meta font-medium text-text-soft">
          {C.activeCount(mode.contact.borrowedCount, mode.contact.lentCount)}
        </p>
      ) : null}
      {galat === null ? null : (
        <Alert
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void save();
              }}
            >
              {C.retry}
            </Button>
          }
        >
          {galat}
        </Alert>
      )}
      <div aria-hidden="true" className="pb-3" />
    </Sheet>
  );
}

/** Dialog arsip kontak (S11-KT2): menyebut akibat (utang lama tetap tercatat dan bisa dibayar). */
export function ArchiveContactDialog({
  open,
  onOpenChange,
  name,
  busy,
  failure,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  busy: boolean;
  failure: LedgerErrorCode | null;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<ArchiveIcon size={22} />}
      title={C.archiveTitle(name)}
      description={C.archiveBody(name)}
      confirmLabel={C.archive}
      cancelLabel={C.back}
      onConfirm={onConfirm}
      holdOpen
      busy={busy}
      alert={failure === null ? undefined : utangFailedText(failure)}
    />
  );
}
