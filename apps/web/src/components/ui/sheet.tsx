'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { XIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './icon-button';

const tints = {
  pribadi: 'bg-pribadi-tint',
  bersama: 'bg-bersama-tint',
} as const;

/** Tinggi area terlihat (mengecil saat keyboard layar muncul). */
function useVisualViewportHeight(active: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setHeight(vv.height);
    };
    update();
    vv.addEventListener('resize', update);
    return () => {
      vv.removeEventListener('resize', update);
    };
  }, [active]);
  return height;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  tint,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  tint?: 'pribadi' | 'bersama' | undefined;
  children: ReactNode;
}) {
  const vvHeight = useVisualViewportHeight(open);
  // Pemicu dikendalikan dari luar (bukan Dialog.Trigger), jadi fokus dikembalikan manual.
  const returnFocusTo = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-text/40 data-[state=open]:animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            returnFocusTo.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocusTo.current?.focus();
          }}
          style={vvHeight === null ? undefined : { maxHeight: vvHeight * 0.9 }}
          className="fixed inset-x-0 bottom-0 flex max-h-dvh flex-col overflow-hidden rounded-t-sheet bg-surface text-text data-[state=open]:animate-sheet-in dialog:inset-x-auto dialog:top-1/2 dialog:bottom-auto dialog:left-1/2 dialog:w-full dialog:max-w-lg dialog:-translate-x-1/2 dialog:-translate-y-1/2 dialog:rounded-sheet"
        >
          <header
            className={`flex items-center justify-between border-b border-hairline py-1 pr-1 pl-4 ${
              tint ? tints[tint] : 'bg-surface'
            }`}
          >
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Tutup" icon={<XIcon size={24} />} />
            </Dialog.Close>
          </header>
          <div className="overflow-y-auto p-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
