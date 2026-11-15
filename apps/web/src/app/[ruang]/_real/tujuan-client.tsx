'use client';

import type { IsoDate } from '@dompetku/domain';
import { createContext, lazy, Suspense, useContext, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ArchiveIcon } from '@/components/ui/icons/archive';
import { PencilSimpleIcon } from '@/components/ui/icons/pencil-simple';
import { PlusIcon } from '@/components/ui/icons/plus';
import { toast } from '@/components/ui/toast';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { focusRing } from '@/components/ui/styles';
import type { ActionResult, LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { TUJUAN_COPY as C } from '@/features/tujuan/copy';
import { goalFailedText, goalRestoreFailedText } from '@/features/tujuan/galat';
import type {
  CreateGoalSubmit,
  GoalSaveResult,
  GoalWallet,
  UpdateGoalSubmit,
} from '@/features/tujuan/goal-sheet';
import type { GoalVM } from '@/features/tujuan/types';
import {
  archiveGoalAction,
  completeGoalAction,
  createGoalAction,
  restoreGoalAction,
  updateGoalAction,
} from '../_actions/tujuan';
import { restoreFocus } from './focus-title';
import { TUJUAN_TITLE_ID } from './tujuan-ids';

/**
 * Pulau klien Tujuan nyata (S13; dimuat malas lewat `tujuan-islands`, chunk TERPISAH dari
 * `rencana-client`: pengguna Anggaran/Tagihan tidak membayar byte Tujuan). `TujuanHost` memegang
 * state sheet/dialog; pemicunya (kartu, header, keadaan kosong) membungkus isi Server Component
 * sebagai `children`. Sheet dan dialog dimuat saat pertama dipakai (pointer/fokus di pemicu memuat
 * lebih awal). Server Action `mutate` memanggil `refresh()`, jadi daftar tampil ulang tanpa
 * navigasi. Selesaikan/Arsipkan memberi `Urungkan` (= `restore_goal`).
 */

const loadSheet = () => import('@/features/tujuan/goal-sheet');
const GoalSheet = lazy(() => loadSheet().then((m) => ({ default: m.GoalSheet })));
const loadDialogs = () => import('@/features/tujuan/goal-dialogs');
const CompleteDialog = lazy(() => loadDialogs().then((m) => ({ default: m.CompleteGoalDialog })));
const ArchiveDialog = lazy(() => loadDialogs().then((m) => ({ default: m.ArchiveGoalDialog })));
const preloadSheet = () => {
  void loadSheet();
};
const preloadDialogs = () => {
  void loadDialogs();
};

/** Galat jaringan Server Action (fetch gagal) = `network`; kode lain diteruskan apa adanya. */
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
  openEdit: (goalId: string) => void;
  openComplete: (goalId: string) => void;
  openArchive: (goalId: string) => void;
}
const Host = createContext<HostApi | null>(null);

function useHost(): HostApi {
  const h = useContext(Host);
  if (h === null) throw new Error('pemicu Tujuan harus di dalam TujuanHost');
  return h;
}

export interface TujuanHostProps {
  ruang: Ruang;
  today: IsoDate;
  /** Dompet tabungan aktif tanpa tujuan aktif (pemilih Tambah). */
  wallets: GoalWallet[];
  /** Tujuan aktif di halaman ini (sumber Ubah, Selesaikan, Arsipkan). */
  goals: GoalVM[];
  /** Anggota lain di Bersama dua anggota (dialog Arsipkan); `null` = Pribadi atau solo. */
  partnerName: string | null;
  /** Tambah dari Detail dompet: dompet terkunci. */
  lockedWalletId?: string | undefined;
  children: ReactNode;
}

export function TujuanHost({
  ruang,
  today,
  wallets,
  goals,
  partnerName,
  lockedWalletId,
  children,
}: TujuanHostProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [dialogId, setDialogId] = useState<string | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogFailure, setDialogFailure] = useState<LedgerErrorCode | null>(null);
  const running = useRef(false);
  const sheetMounted = useOpenedOnce(sheetOpen);
  const completeMounted = useOpenedOnce(completeOpen);
  const archiveMounted = useOpenedOnce(archiveOpen);

  const api: HostApi = {
    ruang,
    openAdd: () => {
      setEditId(null);
      setSheetOpen(true);
    },
    openEdit: (goalId) => {
      setEditId(goalId);
      setSheetOpen(true);
    },
    openComplete: (goalId) => {
      setDialogFailure(null);
      setDialogId(goalId);
      setCompleteOpen(true);
    },
    openArchive: (goalId) => {
      setDialogFailure(null);
      setDialogId(goalId);
      setArchiveOpen(true);
    },
  };

  const editing = goals.find((g) => g.goalId === editId) ?? null;
  const dialogGoal = goals.find((g) => g.goalId === dialogId) ?? null;

  async function create(input: CreateGoalSubmit): Promise<GoalSaveResult> {
    const res = await call(() => createGoalAction(ruang, input));
    return res.ok ? { ok: true } : failOf(res);
  }

  async function update(input: UpdateGoalSubmit): Promise<GoalSaveResult> {
    const res = await call(() => updateGoalAction(ruang, input));
    return res.ok ? { ok: true } : failOf(res);
  }

  /** `Urungkan` Selesaikan/Arsipkan: satu kali per toast, klik ganda aman. */
  function undo(goal: GoalVM): () => void {
    let busy = false;
    return () => {
      if (busy) return;
      busy = true;
      void call(() => restoreGoalAction(ruang, { goalId: goal.goalId }))
        .then((res) => {
          if (!res.ok) {
            toast({
              message:
                res.error.code === 'goal_exists'
                  ? goalFailedText('goal_exists', goal.accountName)
                  : C.undoFailed,
              tone: 'info',
            });
          }
        })
        .finally(() => {
          busy = false;
        });
    };
  }

  async function confirm(kind: 'complete' | 'archive') {
    if (running.current || dialogGoal === null) return;
    running.current = true;
    setDialogBusy(true);
    setDialogFailure(null);
    const goal = dialogGoal;
    const res = await call(() =>
      kind === 'complete'
        ? completeGoalAction(ruang, { goalId: goal.goalId })
        : archiveGoalAction(ruang, { goalId: goal.goalId }),
    );
    running.current = false;
    setDialogBusy(false);
    if (!res.ok) {
      setDialogFailure(res.error.code);
      return;
    }
    (kind === 'complete' ? setCompleteOpen : setArchiveOpen)(false);
    toast({
      message: kind === 'complete' ? C.completedToast(goal.name) : C.archivedToast(goal.name),
      action: { label: C.undo, onAction: undo(goal) },
    });
    // Kartu itu pindah ke `Selesai dan diarsipkan` (fokus jatuh ke body): kembali ke judul bagian.
    restoreFocus(null, `#${TUJUAN_TITLE_ID}`);
  }

  return (
    <Host.Provider value={api}>
      {children}
      {sheetMounted ? (
        <Suspense fallback={null}>
          <GoalSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            ruang={ruang}
            today={today}
            goal={editing}
            wallets={wallets}
            lockedWalletId={lockedWalletId}
            onCreate={create}
            onUpdate={update}
            onSaved={({ name, created }) => {
              setSheetOpen(false);
              toast({
                message: created ? C.createdToast(name, ruang) : C.updatedToast(name, ruang),
              });
              restoreFocus('[data-goal-add]', `#${TUJUAN_TITLE_ID}`);
            }}
          />
        </Suspense>
      ) : null}
      {completeMounted ? (
        <Suspense fallback={null}>
          <CompleteDialog
            open={completeOpen}
            onOpenChange={(o) => {
              if (!dialogBusy) setCompleteOpen(o);
            }}
            goal={dialogGoal}
            busy={dialogBusy}
            failure={dialogFailure}
            onConfirm={() => {
              void confirm('complete');
            }}
          />
        </Suspense>
      ) : null}
      {archiveMounted ? (
        <Suspense fallback={null}>
          <ArchiveDialog
            open={archiveOpen}
            onOpenChange={(o) => {
              if (!dialogBusy) setArchiveOpen(o);
            }}
            goal={dialogGoal}
            partnerName={partnerName}
            busy={dialogBusy}
            failure={dialogFailure}
            onConfirm={() => {
              void confirm('archive');
            }}
          />
        </Suspense>
      ) : null}
    </Host.Provider>
  );
}

/** `Tambah tujuan`: sheet kosong (header, keadaan kosong). */
export function AddGoalButton({
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
      data-goal-add
      onPointerEnter={preloadSheet}
      onFocus={preloadSheet}
      onClick={openAdd}
    >
      {plus ? <PlusIcon size={18} weight="bold" /> : null}
      {C.add}
    </Button>
  );
}

const TEXT_ACTION = `inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-3 text-label font-bold text-accent-text hover-pointer:bg-hover active:bg-surface-2 ${focusRing}`;

/** `Ubah`: nama aksesibel memuat nama tujuan (Label in Name: teks tampak adalah awalnya). */
export function EditGoalButton({ goalId, name }: { goalId: string; name: string }) {
  const { openEdit } = useHost();
  return (
    <button
      type="button"
      className={TEXT_ACTION}
      aria-label={`${C.edit} tujuan ${name}`}
      onPointerEnter={preloadSheet}
      onFocus={preloadSheet}
      onClick={() => {
        openEdit(goalId);
      }}
    >
      <PencilSimpleIcon size={16} />
      {C.edit}
    </button>
  );
}

export function ArchiveGoalButton({ goalId, name }: { goalId: string; name: string }) {
  const { openArchive } = useHost();
  return (
    <button
      type="button"
      className={TEXT_ACTION}
      aria-label={`${C.archive} tujuan ${name}`}
      onPointerEnter={preloadDialogs}
      onFocus={preloadDialogs}
      onClick={() => {
        openArchive(goalId);
      }}
    >
      <ArchiveIcon size={16} />
      {C.archive}
    </button>
  );
}

/** `Selesaikan tujuan`: hanya pada kartu `Tercapai`; membuka dialog TJ6. */
export function CompleteGoalButton({ goalId, name }: { goalId: string; name: string }) {
  const { openComplete } = useHost();
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label={`${C.finish} ${name}`}
      onPointerEnter={preloadDialogs}
      onFocus={preloadDialogs}
      onClick={() => {
        openComplete(goalId);
      }}
    >
      {C.finish}
    </Button>
  );
}

/**
 * `Pulihkan` pada baris Selesai/arsip (TJ8): langsung `restore_goal`, tanpa dialog. Ditolak
 * (dompet sudah punya tujuan aktif lain, dompet terarsip) = pesan di bawah baris.
 */
export function RestoreGoalButton({
  goalId,
  name,
  accountName,
}: {
  goalId: string;
  name: string;
  accountName: string;
}) {
  const { ruang } = useHost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function restore() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await call(() => restoreGoalAction(ruang, { goalId }));
    setBusy(false);
    if (res.ok) {
      toast({ message: C.restoredToast(name) });
      restoreFocus(null, `#${TUJUAN_TITLE_ID}`);
    } else {
      setError(goalRestoreFailedText(res.error.code, accountName));
    }
  }
  return (
    <>
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
      {error === null ? null : (
        <p
          role="status"
          className="flex basis-full items-start gap-1.5 text-meta font-semibold text-text"
        >
          {error}
        </p>
      )}
    </>
  );
}
