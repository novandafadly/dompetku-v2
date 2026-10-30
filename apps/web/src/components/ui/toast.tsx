'use client';

import * as RadixToast from '@radix-ui/react-toast';
import { useSyncExternalStore } from 'react';
import { focusRing } from './styles';

interface ToastInput {
  message: string;
  action?: { label: string; onAction: () => void };
}
interface ToastItem extends ToastInput {
  id: number;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => {
    l();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function toast(input: ToastInput) {
  items = [...items, { ...input, id: nextId++ }];
  emit();
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

const getSnapshot = () => items;

export function Toaster() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <RadixToast.Provider swipeDirection="down" duration={5000} label="Notifikasi">
      {current.map((t) => (
        <RadixToast.Root
          key={t.id}
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
          className="flex min-h-11 items-center justify-between gap-3 rounded-field bg-text px-4 py-2 text-base text-bg data-[state=open]:animate-toast-in"
        >
          <RadixToast.Description>{t.message}</RadixToast.Description>
          {t.action ? (
            <RadixToast.Action
              altText={t.action.label}
              onClick={t.action.onAction}
              className={`min-h-11 min-w-11 rounded-field px-2 font-semibold underline ${focusRing}`}
            >
              {t.action.label}
            </RadixToast.Action>
          ) : null}
        </RadixToast.Root>
      ))}
      {/* Di atas tab bar mobile (tinggi tab bar + celah). */}
      <RadixToast.Viewport className="fixed inset-x-0 bottom-24 z-50 m-0 mx-auto flex w-full max-w-md list-none flex-col gap-2 p-4 outline-none" />
    </RadixToast.Provider>
  );
}
