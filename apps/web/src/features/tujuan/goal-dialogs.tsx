'use client';

import { ArchiveIcon } from '@/components/ui/icons/archive';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { LedgerErrorCode } from '@/features/ledger/types';
import { TUJUAN_COPY as C } from './copy';
import { goalFailedText } from './galat';
import type { GoalVM } from './types';

/**
 * Dialog akibat Tujuan (S13-TJ6, TJ7). Fokus awal `Kembali` (ConfirmDialog); aksi bukan
 * pembatalan uang, jadi `tone="primary"`. Galat `goal_not_reached` menonaktifkan konfirmasi
 * (keadaan sudah berubah: muat ulang).
 */

export function CompleteGoalDialog({
  open,
  onOpenChange,
  goal,
  busy,
  failure,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: GoalVM | null;
  busy: boolean;
  failure: LedgerErrorCode | null;
  onConfirm: () => void;
}) {
  if (goal === null) return null;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="primary"
      icon={<CheckCircleIcon size={22} />}
      title={C.finishTitle(goal.name)}
      description={C.finishBody(goal.accountName)}
      confirmLabel={C.finishConfirm}
      cancelLabel={C.back}
      onConfirm={onConfirm}
      holdOpen
      busy={busy}
      confirmDisabled={failure === 'goal_not_reached'}
      alert={failure === null ? undefined : goalFailedText(failure, goal.accountName)}
    />
  );
}

export function ArchiveGoalDialog({
  open,
  onOpenChange,
  goal,
  partnerName,
  busy,
  failure,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: GoalVM | null;
  /** Anggota lain di Bersama dua anggota; `null` = Pribadi atau solo. */
  partnerName: string | null;
  busy: boolean;
  failure: LedgerErrorCode | null;
  onConfirm: () => void;
}) {
  if (goal === null) return null;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="primary"
      icon={<ArchiveIcon size={22} />}
      title={C.archiveTitle(goal.name)}
      description={
        <div className="flex flex-col gap-2">
          <p>{C.archiveBody(goal.accountName)}</p>
          {partnerName === null ? null : <p>{C.archiveShared(partnerName)}</p>}
        </div>
      }
      confirmLabel={C.archiveConfirm}
      cancelLabel={C.back}
      onConfirm={onConfirm}
      holdOpen
      busy={busy}
      alert={failure === null ? undefined : goalFailedText(failure, goal.accountName)}
    />
  );
}
