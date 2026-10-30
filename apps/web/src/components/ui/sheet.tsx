'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { XIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
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
  headerAction,
  footer,
  initialFocus,
  returnFocus,
  fill = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Juga menyetel aksen ruang (`data-ruang`) untuk isi sheet. */
  tint?: 'pribadi' | 'bersama' | undefined;
  headerAction?: ReactNode;
  /** Tetap terlihat di bawah; hanya isi yang menggulir. */
  footer?: ReactNode;
  /** Elemen yang difokus saat sheet terbuka (bawaan: elemen fokusable pertama). */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  /** Elemen yang difokus saat sheet ditutup (bawaan: elemen yang fokus saat sheet terbuka). */
  returnFocus?: HTMLElement | null | undefined;
  /** Pakai seluruh tinggi area terlihat (mis. di atas keyboard), bukan 90%. */
  fill?: boolean;
  children: ReactNode;
}) {
  const vvHeight = useVisualViewportHeight(open);
  // Pemicu dikendalikan dari luar (bukan Dialog.Trigger), jadi fokus dikembalikan manual.
  const returnFocusTo = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-20 bg-text/40 data-[state=open]:animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          data-ruang={tint}
          onOpenAutoFocus={(e) => {
            returnFocusTo.current =
              returnFocus ??
              (document.activeElement instanceof HTMLElement ? document.activeElement : null);
            const target = initialFocus?.current;
            if (target) {
              e.preventDefault();
              target.focus();
              // Isi yang sudah ada (mis. nominal dari placeholder) dilanjutkan dari ujungnya.
              if (target instanceof HTMLInputElement && target.selectionStart !== null) {
                const end = target.value.length;
                target.setSelectionRange(end, end);
              }
            }
          }}
          onEscapeKeyDown={(e) => {
            // Radix mendengar Escape di fase capture; komponen yang menangani Escape sendiri
            // (mis. Combobox) menandai dirinya agar sheet tidak ikut tertutup.
            if (e.target instanceof Element && e.target.closest('[data-own-escape]')) {
              e.preventDefault();
            }
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocusTo.current?.focus();
          }}
          style={vvHeight === null ? undefined : { maxHeight: fill ? vvHeight : vvHeight * 0.9 }}
          className="fixed inset-x-0 bottom-0 z-20 flex max-h-dvh flex-col overflow-hidden rounded-t-sheet bg-surface text-text data-[state=open]:animate-sheet-in dialog:inset-x-auto dialog:top-1/2 dialog:bottom-auto dialog:left-1/2 dialog:w-full dialog:max-w-lg dialog:-translate-x-1/2 dialog:-translate-y-1/2 dialog:rounded-sheet"
        >
          <header
            className={`flex items-center gap-2 border-b border-hairline py-1 pr-1 pl-4 ${
              tint ? tints[tint] : 'bg-surface'
            }`}
          >
            <Dialog.Title className="mr-auto text-lg/tight font-semibold">{title}</Dialog.Title>
            {headerAction}
            <Dialog.Close asChild>
              <IconButton label="Tutup" icon={<XIcon size={24} />} />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
          {footer === undefined ? null : (
            <div className="border-t border-hairline px-4 py-2">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
