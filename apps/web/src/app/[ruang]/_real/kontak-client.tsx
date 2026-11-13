'use client';

import { useRouter } from 'next/navigation';
import { createContext, lazy, Suspense, useContext, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { PlusIcon } from '@/components/ui/icons/plus';
import { toast } from '@/components/ui/toast';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import type { LedgerErrorCode, Ruang } from '@/features/ledger/types';
import type { ContactMode, ContactResult, ContactSubmit } from '@/features/utang/contact-sheet';
import { UTANG_COPY as C } from '@/features/utang/copy';
import type { ContactVM } from '@/features/utang/types';
import { archiveContactAction, createContactAction, renameContactAction } from '../_actions/utang';
import { restoreFocus } from './focus-title';
import { KONTAK_TITLE_ID } from './utang-ids';

/**
 * Pulau klien Kontak nyata (S11-KT1/KT2; dimuat malas lewat `kontak-islands`): `KontakHost` memegang
 * state sheet Tambah/Ubah dan dialog arsip; baris dan tombol `Tambah kontak` adalah pemicunya.
 * Sheet dan dialog dimuat saat pertama dipakai. Server Action `mutate` memanggil `refresh()`.
 */

const loadSheet = () => import('@/features/utang/contact-sheet');
const Sheet = lazy(() => loadSheet().then((m) => ({ default: m.ContactSheet })));
const ArchiveDialog = lazy(() => loadSheet().then((m) => ({ default: m.ArchiveContactDialog })));
const preload = () => {
  void loadSheet();
};

interface HostApi {
  openAdd: () => void;
  openEdit: (contactId: string) => void;
}
const Host = createContext<HostApi | null>(null);

function useHost(): HostApi {
  const h = useContext(Host);
  if (h === null) throw new Error('pemicu Kontak harus di dalam KontakHost');
  return h;
}

export function KontakHost({
  ruang,
  contacts,
  children,
}: {
  ruang: Ruang;
  contacts: ContactVM[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ContactMode>({ kind: 'add' });
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ContactVM | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<LedgerErrorCode | null>(null);
  const running = useRef(false);
  const mounted = useOpenedOnce(open || archiveOpen);

  const api: HostApi = {
    openAdd: () => {
      setMode({ kind: 'add' });
      setOpen(true);
    },
    openEdit: (contactId) => {
      const contact = contacts.find((c) => c.contactId === contactId);
      if (contact === undefined) return;
      setMode({ kind: 'edit', contact });
      setOpen(true);
    },
  };

  async function submit(input: ContactSubmit): Promise<ContactResult> {
    try {
      const res =
        mode.kind === 'add'
          ? await createContactAction(ruang, input)
          : await renameContactAction(ruang, {
              contactId: mode.contact.contactId,
              name: input.name,
            });
      if (!res.ok) {
        return res.error.field === undefined
          ? { ok: false, code: res.error.code }
          : { ok: false, code: res.error.code, field: res.error.field };
      }
      setOpen(false);
      toast({ message: `Kontak ${input.name} disimpan · Pribadi` });
      return { ok: true };
    } catch {
      return { ok: false, code: 'network' };
    }
  }

  async function confirmArchive() {
    if (running.current || archiveTarget === null) return;
    running.current = true;
    setBusy(true);
    setFailure(null);
    let res;
    try {
      res = await archiveContactAction(ruang, { contactId: archiveTarget.contactId });
    } catch {
      setBusy(false);
      running.current = false;
      setFailure('network');
      return;
    }
    running.current = false;
    setBusy(false);
    if (!res.ok) {
      if (res.error.code === 'not_found') router.refresh();
      setFailure(res.error.code);
      return;
    }
    setArchiveOpen(false);
    toast({ message: C.archived(archiveTarget.name) });
    // Barisnya hilang sesudah muat ulang (fokus jatuh ke body): kembali ke judul halaman.
    restoreFocus(null, `#${KONTAK_TITLE_ID}`);
  }

  return (
    <Host.Provider value={api}>
      {children}
      {mounted ? (
        <Suspense fallback={null}>
          <Sheet
            open={open}
            onOpenChange={setOpen}
            mode={mode}
            onSubmit={submit}
            onArchive={() => {
              if (mode.kind !== 'edit') return;
              // Sheet menutup lebih dulu; dialog arsip menggantikannya (satu lapisan modal sekali).
              setArchiveTarget(mode.contact);
              setFailure(null);
              setOpen(false);
              setArchiveOpen(true);
            }}
          />
          <ArchiveDialog
            open={archiveOpen}
            onOpenChange={(o) => {
              if (!busy) setArchiveOpen(o);
            }}
            name={archiveTarget?.name ?? ''}
            busy={busy}
            failure={failure}
            onConfirm={() => {
              void confirmArchive();
            }}
          />
        </Suspense>
      ) : null}
    </Host.Provider>
  );
}

/** Seluruh baris kontak sebagai satu tombol yang membuka sheet Ubah kontak itu. */
export function ContactRowTrigger({
  contactId,
  className,
  children,
}: {
  contactId: string;
  className: string;
  children: ReactNode;
}) {
  const { openEdit } = useHost();
  return (
    <button
      type="button"
      data-contact-row={contactId}
      className={className}
      onPointerEnter={preload}
      onFocus={preload}
      onClick={() => {
        openEdit(contactId);
      }}
    >
      {children}
    </button>
  );
}

/** `Tambah kontak`: sheet kosong (header laptop, keadaan kosong, tombol HP). */
export function AddContactButton({
  variant,
  plus = false,
  className = '',
}: {
  variant: 'primary' | 'secondary';
  plus?: boolean;
  className?: string;
}) {
  const { openAdd } = useHost();
  return (
    <Button
      variant={variant}
      className={className}
      onPointerEnter={preload}
      onFocus={preload}
      onClick={openAdd}
    >
      {plus ? <PlusIcon size={18} weight="bold" /> : null}
      {C.addContact}
    </Button>
  );
}
