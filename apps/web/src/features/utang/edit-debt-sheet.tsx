'use client';

import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { TextField } from '@/components/ui/text-field';
import { newClientId } from '@/features/ledger/client-id';
import type { LedgerErrorCode } from '@/features/ledger/types';
import { Alert } from '@/components/ui/form-parts';
import { UTANG_COPY as C, sheetTitle } from './copy';
import { ContactControl, InfoBox, SaveButton, type ContactChoice } from './fields';
import type { ContactVM, DebtDetailVM } from './types';

const FORM_ID = 'ubah-utang';
const NAME_MAX = 60;

export interface EditSubmit {
  debtId: string;
  contactId?: string;
  contactName?: string;
  /** Kunci pembuatan kontak baru (stabil per pembukaan: `Coba lagi` tidak menggandakan kontak). */
  contactClientId: string;
  title: string | null;
  note: string | null;
}
export type EditResult = { ok: true } | { ok: false; code: LedgerErrorCode; field?: string };

export interface EditDebtSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: Pick<
    DebtDetailVM,
    'debtId' | 'contactId' | 'contactName' | 'contactArchived' | 'title' | 'note' | 'direction'
  > | null;
  contacts: readonly ContactVM[];
  onSave: (input: EditSubmit) => Promise<EditResult>;
  onSaved: (name: string) => void;
}

/**
 * Sheet `Ubah utang` (S11-DT2, K4): kontak, judul, catatan; tanpa efek ke saldo, cicilan, atau
 * sisa. Nominal pokok tidak tampil sebagai kolom (batalkan pembayarannya atau hapus utang, lalu
 * catat ulang).
 */
export function EditDebtSheet(props: EditDebtSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <EditSession key={session} {...props} />;
}

function EditSession({
  open,
  onOpenChange,
  detail,
  contacts,
  onSave,
  onSaved,
}: EditDebtSheetProps) {
  const [contactClientId] = useState(newClientId);
  const [contact, setContact] = useState<ContactChoice>({
    mode: 'pick',
    contactId: detail?.contactId ?? '',
    name: '',
  });
  const [title, setTitle] = useState(detail?.title ?? '');
  const [note, setNote] = useState(detail?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [galat, setGalat] = useState<string | null>(null);
  const busy = useRef(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const introId = useId();
  if (detail === null) return null;

  async function save() {
    if (busy.current || detail === null) return;
    const name = contact.name.trim();
    if (contact.mode === 'pick' && contact.contactId === '') {
      setError(C.errContact);
      selectRef.current?.focus();
      return;
    }
    if (contact.mode === 'new' && (name.length < 1 || name.length > NAME_MAX)) {
      setError(C.errContactName);
      nameRef.current?.focus();
      return;
    }
    setError(undefined);
    setGalat(null);
    busy.current = true;
    setSaving(true);
    const trimmedTitle = title.trim();
    const trimmedNote = note.trim();
    let res: EditResult;
    try {
      res = await onSave({
        debtId: detail.debtId,
        ...(contact.mode === 'pick' ? { contactId: contact.contactId } : { contactName: name }),
        contactClientId,
        title: trimmedTitle === '' ? null : trimmedTitle,
        note: trimmedNote === '' ? null : trimmedNote,
      });
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (res.ok) {
      onSaved(
        contact.mode === 'new'
          ? name
          : (contacts.find((c) => c.contactId === contact.contactId)?.name ?? detail.contactName),
      );
      return;
    }
    switch (res.code) {
      case 'contact_name_taken':
        setError(C.errContactNameTaken);
        nameRef.current?.focus();
        break;
      case 'contact_archived':
        setError('Kontak ini sudah diarsipkan. Pilih kontak lain.');
        selectRef.current?.focus();
        break;
      case 'debt_deleted':
        setGalat('Utang ini sudah dihapus. Pulihkan utangnya dulu.');
        break;
      case 'not_found':
        setGalat('Data ini tidak ditemukan. Muat ulang halaman.');
        break;
      case 'network':
        setGalat(C.errNetwork);
        break;
      default:
        setGalat('Belum tersimpan. Ada kendala di server. Coba lagi tidak akan mengubah dua kali.');
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
      title={sheetTitle(C.editTitle)}
      titleContent={
        <>
          {C.editTitle}
          <SpaceTag space="pribadi" />
        </>
      }
      tint="pribadi"
      describedBy={introId}
      footer={<SaveButton formId={FORM_ID} saving={saving} label={C.saveChanges} />}
    >
      <p id={introId} className="text-meta font-medium text-text-soft">
        {C.editIntro}
      </p>
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex flex-col gap-3"
      >
        <ContactControl
          contacts={contacts}
          value={contact}
          onChange={(v) => {
            setContact(v);
            setError(undefined);
          }}
          error={error}
          busy={saving}
          selectRef={selectRef}
          nameRef={nameRef}
          current={
            detail.contactArchived ? { id: detail.contactId, name: detail.contactName } : undefined
          }
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
      <InfoBox>{C.editLocked}</InfoBox>
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
