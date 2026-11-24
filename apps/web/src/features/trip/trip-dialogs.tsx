'use client';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ArchiveIcon } from '@/components/ui/icons/archive';
import type { LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { TRIP_COPY as C } from './copy';
import { tripFailedText } from './galat';

/**
 * Dialog `Arsipkan {nama}?` (S15-TR13): `tone="primary"`, fokus awal `Kembali` (ConfirmDialog).
 * Bersama dua anggota menampilkan paragraf tambahan dengan nama pasangan (solo = tanpa paragraf).
 */
export function ArchiveTripDialog({
  open,
  onOpenChange,
  name,
  ruang,
  partnerName,
  busy,
  failure,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  ruang: Ruang;
  /** Anggota lain di Bersama dua anggota; `null` = Pribadi atau solo. */
  partnerName: string | null;
  busy: boolean;
  failure: LedgerErrorCode | null;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="primary"
      icon={<ArchiveIcon size={22} />}
      title={C.archiveTitle(name)}
      description={
        <div className="flex flex-col gap-2">
          <p>{C.archiveBody}</p>
          {partnerName === null ? null : <p>{C.archiveShared(partnerName)}</p>}
        </div>
      }
      confirmLabel={C.archive}
      cancelLabel={C.back}
      onConfirm={onConfirm}
      holdOpen
      busy={busy}
      alert={failure === null ? undefined : tripFailedText(failure, name, ruang)}
    />
  );
}
