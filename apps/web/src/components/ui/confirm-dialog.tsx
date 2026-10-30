'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Button } from './button';

/** Dialog konfirmasi untuk aksi yang mengubah uang (role alertdialog, fokus awal di batal). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-20 bg-text/40 data-[state=open]:animate-fade-in" />
        <AlertDialog.Content className="fixed inset-x-4 top-1/2 z-20 mx-auto max-w-md -translate-y-1/2 rounded-sheet bg-surface p-5 text-text">
          <AlertDialog.Title className="text-lg font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-base">
            {description}
          </AlertDialog.Description>
          <div className="mt-5 flex flex-col-reverse gap-2 dialog:flex-row dialog:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">{cancelLabel}</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="danger" onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
