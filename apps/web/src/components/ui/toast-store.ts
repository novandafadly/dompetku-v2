import { useSyncExternalStore } from 'react';

export interface ToastInput {
  message: string;
  action?: { label: string; onAction: () => void };
}
export interface ToastItem extends ToastInput {
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

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

const getSnapshot = () => items;

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
