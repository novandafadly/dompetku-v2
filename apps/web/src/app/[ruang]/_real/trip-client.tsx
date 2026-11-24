'use client';

import type { IsoDate } from '@dompetku/domain';
import { createContext, lazy, Suspense, useContext, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { InfoIcon } from '@/components/ui/icons/info';
import { PlusIcon } from '@/components/ui/icons/plus';
import { focusRing } from '@/components/ui/styles';
import { toast } from '@/components/ui/toast';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import type { ActionResult, LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { TRIP_COPY as C } from '@/features/trip/copy';
import { tripRestoreFailedText } from '@/features/trip/galat';
import type { CreateTripSubmit, TripSaveResult } from '@/features/trip/trip-sheet';
import { createTripAction, restoreTripAction } from '../_actions/trip';
import { restoreFocus } from './focus-title';
import { TRIP_TITLE_ID } from './trip-ids';

/**
 * Pulau klien daftar Trip nyata (S15-TR2, TR11, TR13; dimuat malas lewat `trip-islands`):
 * `TripListHost` memegang sheet Tambah trip; `AddTripButton` pemicunya; `RestoreTripButton`
 * memulihkan trip terarsip langsung tanpa dialog. Server Action `mutate` menyegarkan daftar.
 */

const loadSheet = () => import('@/features/trip/trip-sheet');
const TripSheet = lazy(() => loadSheet().then((m) => ({ default: m.TripSheet })));
const preloadSheet = () => {
  void loadSheet();
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

interface HostApi {
  ruang: Ruang;
  openAdd: () => void;
}
const Host = createContext<HostApi | null>(null);

function useHost(): HostApi {
  const h = useContext(Host);
  if (h === null) throw new Error('pemicu Trip harus di dalam TripListHost');
  return h;
}

export function TripListHost({
  ruang,
  today,
  children,
}: {
  ruang: Ruang;
  today: IsoDate;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const mounted = useOpenedOnce(open);

  const api: HostApi = {
    ruang,
    openAdd: () => {
      setOpen(true);
    },
  };

  async function create(input: CreateTripSubmit): Promise<TripSaveResult> {
    const res = await call(() => createTripAction(ruang, input));
    return res.ok ? { ok: true, tripId: res.value.tripId } : failOf(res);
  }

  return (
    <Host.Provider value={api}>
      {children}
      {mounted ? (
        <Suspense fallback={null}>
          <TripSheet
            open={open}
            onOpenChange={setOpen}
            ruang={ruang}
            today={today}
            trip={null}
            onCreate={create}
            onUpdate={() => Promise.resolve({ ok: false, code: 'unknown' })}
            onSaved={({ tripId, name }) => {
              setOpen(false);
              toast({ message: C.createdToast(name, ruang) });
              restoreFocus(`[data-trip-row="${tripId}"]`, `#${TRIP_TITLE_ID}`);
            }}
          />
        </Suspense>
      ) : null}
    </Host.Provider>
  );
}

/** `Tambah trip`: header laptop/HP atau aksi primer keadaan kosong. */
export function AddTripButton({
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
      data-trip-add
      onPointerEnter={preloadSheet}
      onFocus={preloadSheet}
      onClick={openAdd}
    >
      {plus ? <PlusIcon size={18} weight="bold" /> : null}
      {C.add}
    </Button>
  );
}

/**
 * `Pulihkan` (S15-TR13): tombol teks 44 di baris `Trip diarsipkan` (`variant="row"`) atau tombol
 * sekunder 44 di banner Detail (`variant="banner"`). Langsung jalan tanpa dialog; `name_taken`
 * menampilkan teks `role="status"` di baris/banner.
 */
export function RestoreTripButton({
  ruang: propRuang,
  tripId,
  name,
  variant = 'row',
  focusId = TRIP_TITLE_ID,
}: {
  ruang?: Ruang;
  tripId: string;
  name: string;
  variant?: 'row' | 'banner';
  focusId?: string;
}) {
  const host = useContext(Host);
  const ruang = propRuang ?? host?.ruang;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ruang === undefined) throw new Error('RestoreTripButton butuh ruang atau TripListHost');

  async function restore() {
    if (busy || ruang === undefined) return;
    setBusy(true);
    setError(null);
    const res = await call(() => restoreTripAction(ruang, { tripId }));
    setBusy(false);
    if (res.ok) {
      toast({ message: C.restoredToast(name) });
      restoreFocus(`[data-trip-row="${tripId}"]`, `#${focusId}`);
    } else {
      setError(tripRestoreFailedText(res.error.code, name));
    }
  }

  return (
    <>
      {variant === 'banner' ? (
        <Button
          variant="secondary"
          size="sm"
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
          aria-label={C.restoreLabel(name)}
          onClick={() => {
            void restore();
          }}
        >
          {C.restore}
        </Button>
      ) : (
        <button
          type="button"
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
          aria-label={C.restoreLabel(name)}
          onClick={() => {
            void restore();
          }}
          className={`inline-flex min-h-11 items-center rounded-lg px-3 text-label font-bold text-accent-text hover-pointer:bg-hover active:bg-surface-2 aria-disabled:text-text-muted ${focusRing}`}
        >
          {C.restore}
        </button>
      )}
      {error === null ? null : (
        <p
          role="status"
          className="flex basis-full items-start gap-1.5 text-meta font-semibold text-text"
        >
          <InfoIcon size={14} className="mt-0.5 shrink-0" />
          <span className="text-pretty">{error}</span>
        </p>
      )}
    </>
  );
}
