'use client';

import type { IsoDate } from '@dompetku/domain';
import { createContext, lazy, Suspense, useContext, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ArchiveIcon } from '@/components/ui/icons/archive';
import { MinusCircleIcon } from '@/components/ui/icons/minus-circle';
import { PencilSimpleIcon } from '@/components/ui/icons/pencil-simple';
import { focusRing } from '@/components/ui/styles';
import { toast } from '@/components/ui/toast';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { newClientId } from '@/features/ledger/client-id';
import type { TripCandidateVM, TripOverviewVM } from '@/features/ledger/trip-types';
import type { ActionResult, LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { TRIP_COPY as C } from '@/features/trip/copy';
import { tripEntryActionFailedText, tripRestoreFailedText } from '@/features/trip/galat';
import type { ImportResult } from '@/features/trip/import-entries-sheet';
import type { TripSaveResult, UpdateTripSubmit } from '@/features/trip/trip-sheet';
import {
  archiveTripAction,
  restoreTripAction,
  setEntriesTripAction,
  updateTripAction,
} from '../_actions/trip';
import { restoreFocus } from './focus-title';
import { TRIP_DETAIL_TITLE_ID, TRIP_ENTRIES_HEADING_ID } from './trip-ids';

/**
 * Pulau klien Detail trip nyata (S15-TR5..TR13; dimuat malas lewat `trip-detail-islands`, chunk
 * terpisah dari daftar Trip): Ubah trip, Arsipkan, Masukkan kandidat, dan Keluarkan per baris.
 */

const loadSheet = () => import('@/features/trip/trip-sheet');
const TripSheet = lazy(() => loadSheet().then((m) => ({ default: m.TripSheet })));
const preloadSheet = () => {
  void loadSheet();
};

const loadDialog = () => import('@/features/trip/trip-dialogs');
const ArchiveTripDialog = lazy(() => loadDialog().then((m) => ({ default: m.ArchiveTripDialog })));
const preloadDialog = () => {
  void loadDialog();
};

const loadImport = () => import('@/features/trip/import-entries-sheet');
const ImportEntriesSheet = lazy(() =>
  loadImport().then((m) => ({ default: m.ImportEntriesSheet })),
);
const preloadImport = () => {
  void loadImport();
};

async function call<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch {
    return { ok: false, error: { code: 'network' } };
  }
}

function failOf(res: { ok: false; error: { code: LedgerErrorCode; field?: string } }): {
  ok: false;
  code: LedgerErrorCode;
  field?: string;
} {
  return res.error.field === undefined
    ? { ok: false, code: res.error.code }
    : { ok: false, code: res.error.code, field: res.error.field };
}

interface DetailHostApi {
  ruang: Ruang;
  trip: TripOverviewVM;
  openEdit: (focus?: 'name' | 'budget') => void;
  openArchive: () => void;
  openImport: () => void;
}
const Host = createContext<DetailHostApi | null>(null);

function useHost(): DetailHostApi {
  const h = useContext(Host);
  if (h === null) throw new Error('pemicu Detail trip harus di dalam TripDetailHost');
  return h;
}

export function TripDetailHost({
  ruang,
  today,
  trip,
  candidates,
  partnerName,
  children,
}: {
  ruang: Ruang;
  today: IsoDate;
  trip: TripOverviewVM;
  candidates: TripCandidateVM[];
  /** Anggota lain di Bersama dua anggota (dialog Arsipkan); `null` = Pribadi atau solo. */
  partnerName: string | null;
  children: ReactNode;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [editFocus, setEditFocus] = useState<'name' | 'budget'>('name');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveFailure, setArchiveFailure] = useState<LedgerErrorCode | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const running = useRef(false);
  const editMounted = useOpenedOnce(editOpen);
  const archiveMounted = useOpenedOnce(archiveOpen);
  const importMounted = useOpenedOnce(importOpen);

  const api: DetailHostApi = {
    ruang,
    trip,
    openEdit: (focus = 'name') => {
      setEditFocus(focus);
      setEditOpen(true);
    },
    openArchive: () => {
      setArchiveFailure(null);
      setArchiveOpen(true);
    },
    openImport: () => {
      setImportOpen(true);
    },
  };

  async function update(input: UpdateTripSubmit): Promise<TripSaveResult> {
    const res = await call(() => updateTripAction(ruang, input));
    return res.ok ? { ok: true, tripId: res.value.tripId } : failOf(res);
  }

  function undoArchive(tripId: string, name: string): () => void {
    let busy = false;
    return () => {
      if (busy) return;
      busy = true;
      void call(() => restoreTripAction(ruang, { tripId }))
        .then((res) => {
          if (!res.ok) {
            toast({ message: tripRestoreFailedText(res.error.code, name), tone: 'info' });
          }
        })
        .finally(() => {
          busy = false;
        });
    };
  }

  async function confirmArchive() {
    if (running.current) return;
    running.current = true;
    setArchiveBusy(true);
    setArchiveFailure(null);
    const res = await call(() => archiveTripAction(ruang, { tripId: trip.id }));
    running.current = false;
    setArchiveBusy(false);
    if (!res.ok) {
      setArchiveFailure(res.error.code);
      return;
    }
    setArchiveOpen(false);
    toast({
      message: C.archivedToast(trip.name),
      action: { label: C.undo, onAction: undoArchive(trip.id, trip.name) },
    });
    restoreFocus(null, `#${TRIP_DETAIL_TITLE_ID}`);
  }

  async function confirmImport(input: {
    clientId: string;
    entryIds: string[];
  }): Promise<ImportResult> {
    const res = await call(() =>
      setEntriesTripAction(ruang, {
        clientId: input.clientId,
        tripId: trip.id,
        entryIds: input.entryIds,
      }),
    );
    return res.ok ? { ok: true, changed: res.value.changed } : { ok: false, code: res.error.code };
  }

  function undoImport(entryIds: string[]): () => void {
    const undoId = newClientId();
    let busy = false;
    return () => {
      if (busy) return;
      busy = true;
      void call(() => setEntriesTripAction(ruang, { clientId: undoId, tripId: null, entryIds }))
        .then((res) => {
          if (!res.ok) {
            toast({ message: tripEntryActionFailedText(res.error.code, true), tone: 'info' });
          }
        })
        .finally(() => {
          busy = false;
        });
    };
  }

  return (
    <Host.Provider value={api}>
      {children}
      {editMounted ? (
        <Suspense fallback={null}>
          <TripSheet
            open={editOpen}
            onOpenChange={setEditOpen}
            ruang={ruang}
            today={today}
            trip={trip}
            initialFocusField={editFocus}
            onCreate={() => Promise.resolve({ ok: false, code: 'unknown' })}
            onUpdate={update}
            onSaved={({ name }) => {
              setEditOpen(false);
              toast({ message: C.updatedToast(name, ruang) });
            }}
          />
        </Suspense>
      ) : null}
      {archiveMounted ? (
        <Suspense fallback={null}>
          <ArchiveTripDialog
            open={archiveOpen}
            onOpenChange={(o) => {
              if (!archiveBusy) setArchiveOpen(o);
            }}
            name={trip.name}
            ruang={ruang}
            partnerName={partnerName}
            busy={archiveBusy}
            failure={archiveFailure}
            onConfirm={() => {
              void confirmArchive();
            }}
          />
        </Suspense>
      ) : null}
      {importMounted ? (
        <Suspense fallback={null}>
          <ImportEntriesSheet
            open={importOpen}
            onOpenChange={setImportOpen}
            ruang={ruang}
            tripName={trip.name}
            candidates={candidates}
            onConfirm={confirmImport}
            onImported={({ entryIds, changed }) => {
              setImportOpen(false);
              const n = changed > 0 ? changed : entryIds.length;
              toast({
                message: C.importedToast(n, trip.name),
                action: { label: C.undo, onAction: undoImport(entryIds) },
              });
              restoreFocus(null, `#${TRIP_ENTRIES_HEADING_ID}`);
            }}
          />
        </Suspense>
      ) : null}
    </Host.Provider>
  );
}

const TEXT_ACTION = `inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-3 text-label font-bold text-accent-text hover-pointer:bg-hover active:bg-surface-2 ${focusRing}`;

export function EditTripButton() {
  const { openEdit } = useHost();
  return (
    <Button
      variant="secondary"
      size="sm"
      onPointerEnter={preloadSheet}
      onFocus={preloadSheet}
      onClick={() => {
        openEdit('name');
      }}
    >
      <PencilSimpleIcon size={16} />
      {C.edit}
    </Button>
  );
}

export function AddTripBudgetButton() {
  const { openEdit } = useHost();
  return (
    <button
      type="button"
      onPointerEnter={preloadSheet}
      onFocus={preloadSheet}
      onClick={() => {
        openEdit('budget');
      }}
      className={`inline-flex min-h-11 items-center self-start rounded-md px-1 text-label font-bold text-accent-text hover-pointer:underline ${focusRing}`}
    >
      {C.addBudget}
    </button>
  );
}

export function ArchiveTripButton() {
  const { openArchive } = useHost();
  return (
    <button
      type="button"
      className={TEXT_ACTION}
      onPointerEnter={preloadDialog}
      onFocus={preloadDialog}
      onClick={openArchive}
    >
      <ArchiveIcon size={16} />
      {C.archive}
    </button>
  );
}

export function ImportEntriesButton({ count }: { count: number }) {
  const { openImport } = useHost();
  return (
    <Button
      variant="secondary"
      size="sm"
      onPointerEnter={preloadImport}
      onFocus={preloadImport}
      onClick={openImport}
    >
      {C.importButton(count)}
    </Button>
  );
}

/**
 * Tombol ikon 44×44 `Keluarkan dari trip` (S15-TR8): langsung melepas tanpa dialog + toast
 * `Urungkan`. Fokus pindah ke baris berikutnya (atau `h2` daftar bila habis).
 */
export function RemoveTripEntryButton({
  entryId,
  title,
  nextEntryId,
}: {
  entryId: string;
  title: string;
  nextEntryId: string | null;
}) {
  const { ruang, trip } = useHost();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (busy) return;
    setBusy(true);
    const res = await call(() =>
      setEntriesTripAction(ruang, {
        clientId: newClientId(),
        tripId: null,
        entryIds: [entryId],
      }),
    );
    setBusy(false);
    if (!res.ok) {
      toast({ message: tripEntryActionFailedText(res.error.code), tone: 'info' });
      return;
    }
    const undoId = newClientId();
    let undoing = false;
    toast({
      message: C.removedToast(title, trip.name),
      action: {
        label: C.undo,
        onAction: () => {
          if (undoing) return;
          undoing = true;
          void call(() =>
            setEntriesTripAction(ruang, {
              clientId: undoId,
              tripId: trip.id,
              entryIds: [entryId],
            }),
          )
            .then((r) => {
              if (!r.ok) {
                toast({ message: tripEntryActionFailedText(r.error.code, true), tone: 'info' });
              }
            })
            .finally(() => {
              undoing = false;
            });
        },
      },
    });
    restoreFocus(
      nextEntryId === null ? null : `[data-trip-entry-row="${nextEntryId}"] a`,
      `#${TRIP_ENTRIES_HEADING_ID}`,
    );
  }

  const label = C.removeEntryLabel(title);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={() => {
        void remove();
      }}
      className={`inline-flex size-11 items-center justify-center rounded-lg text-text-muted hover-pointer:bg-hover hover-pointer:text-text active:bg-surface-2 aria-disabled:text-text-muted ${focusRing}`}
    >
      <MinusCircleIcon size={20} />
    </button>
  );
}
