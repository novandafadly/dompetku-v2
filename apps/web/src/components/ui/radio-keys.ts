import type { KeyboardEvent } from 'react';

/** Panah kiri/kanan (dan atas/bawah) memindah fokus + pilihan di grup role="radiogroup". */
export function handleRadioArrowKeys(e: KeyboardEvent<HTMLElement>) {
  const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
  const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
  if (!forward && !backward) return;
  const radios = [
    ...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'),
  ];
  const current = radios.findIndex((r) => r === document.activeElement);
  if (current === -1) return;
  e.preventDefault();
  const next = radios[(current + (forward ? 1 : -1) + radios.length) % radios.length];
  next?.focus();
  next?.click();
}
