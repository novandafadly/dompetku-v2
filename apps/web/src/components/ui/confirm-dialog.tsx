'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useRef, type ReactNode } from 'react';
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon?: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-30 bg-scrim data-[state=open]:animate-fade-in" />
        <AlertDialog.Content
          onOpenAutoFocus={(e) => {
            // Tombol aman lebih dulu: Enter tidak membatalkan transaksi tanpa sengaja.
            e.preventDefault();
            cancelRef.current?.focus();
          }}
          className="fixed inset-x-4 top-1/2 z-30 mx-auto flex max-w-90 -translate-y-1/2 flex-col gap-3.5 rounded-2xl border border-hairline bg-surface p-5 text-text shadow-float"
        >
          {icon ? (
            <span
              aria-hidden="true"
              className="flex size-11 items-center justify-center rounded-lg bg-danger-tint text-danger"
            >
              {icon}
            </span>
          ) : null}
          <AlertDialog.Title className="text-header font-extrabold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-body font-medium text-text-soft">
            {description}
          </AlertDialog.Description>
          <div className="mt-1 flex flex-col gap-2">
            <AlertDialog.Action asChild>
              <Button variant="danger-fill" className="w-full" onClick={onConfirm}>
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
