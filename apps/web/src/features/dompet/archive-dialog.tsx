'use client';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ArchiveIcon } from '@/components/ui/icons/archive';
import type { LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { RUANG_NAME } from './context';

/**
 * Dialog arsip dompet (S7-W3), dimuat malas oleh halaman riwayat dompet. Kartu keterangan saldo ≠ 0
 * ada di `archive-blocked-card.tsx` (Server Component, tanpa JS).
 */

export const archiveWalletDescription = (name: string, ruang: Ruang): string =>
  `${name} tidak ditawarkan lagi di Catat ${RUANG_NAME[ruang]}. Riwayat transaksinya tetap ada.`;

/** Galat di dalam dialog; tanpa nominal. */
export function archiveFailedText(code: LedgerErrorCode, name: string): string {
  switch (code) {
    case 'balance_not_zero':
      return `${name} masih berisi saldo, jadi belum bisa diarsipkan. Pindahkan isinya dulu.`;
    case 'network':
      return 'Belum bisa diarsipkan. Periksa koneksi lalu coba lagi.';
    case 'not_found':
      return 'Dompet ini sudah tidak ada. Muat ulang halaman.';
    default:
      return 'Belum bisa diarsipkan. Ada kendala di server.';
  }
}

export function ArchiveWalletDialog({
  open,
  onOpenChange,
  name,
  ruang,
  busy,
  failure,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  ruang: Ruang;
  busy: boolean;
  failure: LedgerErrorCode | null;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<ArchiveIcon size={22} />}
      title={`Arsipkan ${name}?`}
      description={
        <>
          <p>{archiveWalletDescription(name, ruang)}</p>
          {ruang === 'bersama' ? (
            <p className="mt-2">
              Dompet ini dipakai bersama; anggota lain juga tidak melihatnya di Catat lagi.
            </p>
          ) : null}
        </>
      }
      confirmLabel="Arsipkan"
      cancelLabel="Kembali"
      onConfirm={onConfirm}
      holdOpen
      busy={busy}
      // Server sudah menjawab saldo ≠ 0: mengulang tidak ada gunanya sampai halaman dimuat ulang.
      confirmDisabled={failure === 'balance_not_zero'}
      alert={failure === null ? undefined : archiveFailedText(failure, name)}
    />
  );
}
