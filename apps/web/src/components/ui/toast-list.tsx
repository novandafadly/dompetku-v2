'use client';

import * as RadixToast from '@radix-ui/react-toast';
import { dismissToast, useToasts } from './toast-store';

/** Daftar toast di dalam wilayah Notifikasi milik `Toaster`; pengumuman ke `announcer`. */
export function ToastList({ announcer }: { announcer: HTMLElement }) {
  const current = useToasts();
  return (
    <RadixToast.Provider
      swipeDirection="down"
      duration={5000}
      label="Notifikasi"
      announcerContainer={announcer}
    >
      {current.map((t) => (
        <RadixToast.Root
          key={t.id}
          onOpenChange={(open) => {
            if (!open) dismissToast(t.id);
          }}
          className="flex min-h-11 items-center justify-between gap-3 rounded-card bg-text px-4 py-2 text-base text-bg data-[state=open]:animate-toast-in"
        >
          <RadixToast.Description>{t.message}</RadixToast.Description>
          {t.action ? (
            <RadixToast.Action
              altText={t.action.label}
              onClick={t.action.onAction}
              className={`min-h-11 min-w-11 rounded-field px-2 font-semibold underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bg`}
            >
              {t.action.label}
            </RadixToast.Action>
          ) : null}
        </RadixToast.Root>
      ))}
      {/* Posisi (di atas tab bar mobile) diatur wilayah induk di Toaster. */}
      <RadixToast.Viewport
        label="Daftar notifikasi ({hotkey})"
        className="m-0 flex list-none flex-col gap-2 p-4 outline-none"
      />
    </RadixToast.Provider>
  );
}
