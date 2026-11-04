'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { newClientId } from '@/features/catat/client-id';
import { undoOrNotify } from '@/features/catat/saved-toast';
import type { ReconcileSaved, ReconcileSource } from '@/features/dompet/reconcile-sheet';
import { archivedWalletToast, reconciledToast } from '@/features/dompet/toasts';
import type { LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { RUANG_LABEL } from '@/features/shell/hrefs';
import { archiveAccountAction, reconcileAction } from '../_actions/dompet';
import { voidEntryAction } from '../_actions/entri';
import { focusHeadingAt } from './focus-title';

/**
 * Aksi riwayat dompet nyata (pulau klien, dimuat malas lewat `dompet-actions-islands`): tombol
 * `Cocokkan saldo` (sheet dimuat saat pertama dipakai) dan `Arsipkan dompet` (dialog juga).
 * Sumber = Server Action ruang ini; fetch action yang putus = `network`.
 */

const loadReconcile = () => import('@/features/dompet/reconcile-sheet');
const ReconcileSheet = lazy(() => loadReconcile().then((m) => ({ default: m.ReconcileSheet })));
const preloadReconcile = () => {
  void loadReconcile();
};

const loadArchive = () => import('@/features/dompet/archive-dialog');
const ArchiveWalletDialog = lazy(() =>
  loadArchive().then((m) => ({ default: m.ArchiveWalletDialog })),
);
const preloadArchive = () => {
  void loadArchive();
};

function realReconcileSource(ruang: Ruang): ReconcileSource {
  return {
    async reconcile(req) {
      try {
        const res = await reconcileAction(ruang, req);
        return res.ok
          ? { ok: true, value: { entryId: res.value.entryId, difference: res.value.difference } }
          : res;
      } catch {
        return { ok: false, error: { code: 'network' } };
      }
    },
  };
}

export const RECONCILE_UNDO_FAILED =
  'Belum bisa diurungkan. Buka penyesuaian itu di riwayat dompet untuk membatalkannya.';

export interface ReconcileButtonProps {
  ruang: Ruang;
  account: { id: string; name: string; balance: number };
}

export function ReconcileButton({ ruang, account }: ReconcileButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const mounted = useOpenedOnce(open);
  const source = useMemo(() => realReconcileSource(ruang), [ruang]);

  function saved(result: ReconcileSaved) {
    router.refresh();
    const { entryId, difference } = result;
    if (entryId === null) {
      // Di server selisihnya sudah 0 (saldo berubah sejak pratinjau): tidak ada entri.
      toast({ message: `Saldo ${account.name} sudah sama. Tidak ada yang dicatat.` });
      return;
    }
    // Penyesuaian baru selalu versi 1; satu clientId per toast (klik berulang = permintaan sama).
    const clientId = newClientId();
    let running = false;
    toast({
      message: reconciledToast(account.name, RUANG_LABEL[ruang], difference),
      action: {
        label: 'Urungkan',
        onAction: () => {
          if (running) return;
          running = true;
          void undoOrNotify(
            async (id: string) => {
              const res = await voidEntryAction(ruang, {
                clientId,
                entryId: id,
                expectedVersion: 1,
              });
              if (res.ok) router.refresh();
              return res.ok;
            },
            entryId,
            toast,
            RECONCILE_UNDO_FAILED,
          ).finally(() => {
            running = false;
          });
        },
      },
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onPointerEnter={preloadReconcile}
        onFocus={preloadReconcile}
        onClick={() => {
          setOpen(true);
        }}
      >
        Cocokkan saldo
      </Button>
      {mounted ? (
        <Suspense fallback={null}>
          <ReconcileSheet
            open={open}
            onOpenChange={setOpen}
            ruang={ruang}
            account={account}
            source={source}
            onSaved={saved}
            onStale={() => {
              router.refresh();
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}

export interface ArchiveButtonProps {
  ruang: Ruang;
  account: { id: string; name: string };
  /** Daftar Dompet ruang ini (tujuan sesudah arsip). */
  dompetHref: Route;
}

export function ArchiveButton({ ruang, account, dompetHref }: ArchiveButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<LedgerErrorCode | null>(null);
  const running = useRef(false);
  const mounted = useOpenedOnce(open);

  async function confirm() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFailure(null);
    let res: Awaited<ReturnType<typeof archiveAccountAction>>;
    try {
      res = await archiveAccountAction(ruang, account.id);
    } catch {
      res = { ok: false, error: { code: 'network' } };
    } finally {
      running.current = false;
      setBusy(false);
    }
    if (!res.ok) {
      setFailure(res.error.code);
      return;
    }
    setOpen(false);
    toast({ message: archivedWalletToast(account.name, ruang) });
    router.push(dompetHref);
    focusHeadingAt(dompetHref);
  }

  return (
    <>
      <button
        type="button"
        onPointerEnter={preloadArchive}
        onFocus={preloadArchive}
        onClick={() => {
          setFailure(null);
          setOpen(true);
        }}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-lg px-3 text-label font-bold text-danger hover-pointer:bg-danger-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        Arsipkan dompet
      </button>
      {mounted ? (
        <Suspense fallback={null}>
          <ArchiveWalletDialog
            open={open}
            onOpenChange={setOpen}
            name={account.name}
            ruang={ruang}
            busy={busy}
            failure={failure}
            onConfirm={() => {
              void confirm();
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
