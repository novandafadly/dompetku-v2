'use client';

import * as RadixToast from '@radix-ui/react-toast';
import { CheckCircleIcon } from './icons/check-circle';
import { InfoIcon } from './icons/info';
import { dismissToast, useToasts } from './toast-store';

/** Toast tampil 6 detik; Radix menjeda hitungan saat pointer di atasnya atau fokus di dalamnya. */
const DURATION = 6000;

/** Daftar toast di dalam wilayah Notifikasi milik `Toaster`; pengumuman ke `announcer`. */
export function ToastList({ announcer }: { announcer: HTMLElement }) {
  const current = useToasts();
  return (
    <RadixToast.Provider
      swipeDirection="down"
      duration={DURATION}
      label="Notifikasi"
      announcerContainer={announcer}
    >
      {current.map((t) => (
        <RadixToast.Root
          key={t.id}
          onOpenChange={(open) => {
            if (!open) dismissToast(t.id);
          }}
          className="flex min-h-13 items-center gap-2.5 rounded-toast bg-toast-bg py-1 pr-1 pl-3.5 text-toast-text shadow-float data-[state=open]:animate-toast-in"
        >
          {t.tone === 'info' ? (
            <InfoIcon size={20} weight="fill" className="shrink-0" />
          ) : (
            <CheckCircleIcon size={20} weight="fill" className="shrink-0" />
          )}
          <RadixToast.Description className="min-w-0 flex-1 py-2 text-label font-semibold">
            {t.message}
          </RadixToast.Description>
          {t.action ? (
            <RadixToast.Action
              altText={t.action.label}
              onClick={t.action.onAction}
              className="min-h-11 min-w-11 shrink-0 rounded-md px-3.5 text-label font-extrabold text-toast-action hover-pointer:underline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-toast-action"
            >
              {t.action.label}
            </RadixToast.Action>
          ) : null}
        </RadixToast.Root>
      ))}
      {/* Posisi (di atas tab bar mobile, kanan bawah di laptop) diatur wilayah induk di Toaster. */}
      <RadixToast.Viewport
        label="Daftar notifikasi ({hotkey})"
        className="m-0 flex list-none flex-col gap-2 p-0 outline-none"
      />
    </RadixToast.Provider>
  );
}
