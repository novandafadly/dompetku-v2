'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './button';

/** Dialog konfirmasi untuk aksi yang mengubah uang (role alertdialog, fokus awal di tombol aman). */
export function ConfirmDialog({
  open,
  onOpenChange,
  icon,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  tone = 'danger',
  holdOpen = false,
  busy = false,
  alert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon?: ReactNode;
  title: string;
  /** Teks, atau isi bebas (mis. daftar akibat); dirender di elemen deskripsi dialog. */
  description: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  /** `primary`: aksi yang bukan pembatalan (ikon dan tombol tidak berwarna bahaya). */
  tone?: 'danger' | 'primary';
  /**
   * Dialog tidak menutup sendiri sesudah konfirmasi: pemanggil menutupnya saat berhasil dan
   * menampilkan `alert` bila gagal (aksi yang bisa ditolak server).
   */
  holdOpen?: boolean;
  /** Selama aksi berjalan: tombol `aria-disabled`, klik diabaikan. */
  busy?: boolean;
  /** Pesan galat di dalam dialog (`role="alert"`); muncul = fokus kembali ke tombol aman. */
  alert?: ReactNode;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (alert !== undefined && alert !== null) cancelRef.current?.focus();
  }, [alert]);
  // Dialog dibuka dari luar (tanpa Trigger), jadi fokus dikembalikan manual ke pemicunya.
  const returnTo = useRef<HTMLElement | null>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-30 bg-scrim data-[state=open]:animate-fade-in" />
        <AlertDialog.Content
          onOpenAutoFocus={(e) => {
            // Tombol aman lebih dulu: Enter tidak membatalkan transaksi tanpa sengaja.
            e.preventDefault();
            returnTo.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            cancelRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (returnTo.current?.isConnected) returnTo.current.focus();
          }}
          className="fixed inset-x-4 top-1/2 z-30 mx-auto flex max-w-90 -translate-y-1/2 flex-col gap-3.5 rounded-2xl border border-hairline bg-surface p-5 text-text shadow-float"
        >
          {icon ? (
            <span
              aria-hidden="true"
              className={`flex size-11 items-center justify-center rounded-lg ${
                tone === 'danger' ? 'bg-danger-tint text-danger' : 'bg-surface-2 text-text-soft'
              }`}
            >
              {icon}
            </span>
          ) : null}
          <AlertDialog.Title className="text-header font-extrabold">{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="text-body font-medium text-text-soft">{description}</div>
          </AlertDialog.Description>
          {alert === undefined || alert === null ? null : (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-danger-tint p-3 text-label font-semibold text-danger"
            >
              {alert}
            </p>
          )}
          <div className="mt-1 flex flex-col gap-2">
            <AlertDialog.Action asChild>
              <Button
                variant={tone === 'danger' ? 'danger-fill' : 'primary'}
                className="w-full"
                aria-disabled={busy || undefined}
                aria-busy={busy || undefined}
                onClick={(e) => {
                  if (holdOpen) e.preventDefault();
                  if (busy) {
                    e.preventDefault();
                    return;
                  }
                  onConfirm();
                }}
              >
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
            <AlertDialog.Cancel asChild>
              <Button ref={cancelRef} variant="secondary" className="w-full">
                {cancelLabel}
              </Button>
            </AlertDialog.Cancel>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
