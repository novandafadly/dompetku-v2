'use client';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ArchiveIcon } from '@/components/ui/icons/archive';
import type { Ruang } from '@/features/ledger/types';

const RUANG_NAME: Record<Ruang, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };

/** Salinan S6-K2 (docs/design/s6-bingkai.md); toast `{nama} diarsipkan di {Ruang}` dipakai pemanggil. */
export const archiveDescription = (name: string, ruang: Ruang, childCount: number): string =>
  `${name} tidak ditawarkan lagi di Catat ${RUANG_NAME[ruang]}. Transaksi lama tetap memakai kategori ini.` +
  (childCount > 0 ? ` ${String(childCount)} subkategori ikut diarsipkan.` : '');

export const archivedToast = (name: string, ruang: Ruang): string =>
  `${name} diarsipkan di ${RUANG_NAME[ruang]}`;

/**
 * Dialog arsip kategori (S6-K2): menyebut akibat sebelum terjadi. `AlertDialog` (Radix) lewat
 * `ConfirmDialog`: fokus awal di `Kembali`, bukan di aksi bahaya.
 */
export function ArchiveDialog({
  open,
  onOpenChange,
  name,
  ruang,
  childCount,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  ruang: Ruang;
  /** Subkategori aktif yang ikut diarsipkan. */
  childCount: number;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<ArchiveIcon size={22} />}
      title={`Arsipkan ${name}?`}
      description={archiveDescription(name, ruang, childCount)}
      confirmLabel="Arsipkan"
      cancelLabel="Kembali"
      onConfirm={onConfirm}
    />
  );
}
