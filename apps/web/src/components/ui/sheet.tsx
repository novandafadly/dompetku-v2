'use client';

import * as Dialog from '@radix-ui/react-dialog';
import {
  useEffect,
  useRef,
  useState,
  type MouseEventHandler,
  type ReactNode,
  type RefObject,
} from 'react';
import { IconButton } from './icon-button';
import { XIcon } from './icons/x';
import { SHEET_HANDLE, SHEET_PANEL } from './styles';

/** Tinggi area terlihat (mengecil saat keyboard layar muncul). */
export function useVisualViewportHeight(active: boolean): number | null {
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
  titleContent,
  titleHidden = false,
  tint,
  headerStart,
  headerAction,
  footer,
  initialFocus,
  returnFocus,
  fill = false,
  compact = false,
  describedBy,
  onClickCapture,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nama dialog; juga isi judul bila `titleContent` tidak diberikan. */
  title: string;
  /** Isi judul yang tampil (mis. tombol pemilih jenis); teksnya harus sama dengan `title`. */
  titleContent?: ReactNode;
  /** Judul hanya untuk pembaca layar (halaman kedua sheet punya judul sendiri). */
  titleHidden?: boolean;
  /** Ruang tujuan: menyetel warna ruang (`data-ruang`) untuk isi sheet. */
  tint?: 'pribadi' | 'bersama' | undefined;
  /** Di kiri judul, mis. tombol Kembali. */
  headerStart?: ReactNode;
  /** Di antara judul dan tombol Tutup. */
  headerAction?: ReactNode;
  /** Tetap terlihat di bawah; hanya isi yang menggulir. */
  footer?: ReactNode;
  /** Elemen yang difokus saat sheet terbuka (bawaan: elemen fokusable pertama). */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  /** Elemen yang difokus saat sheet ditutup (bawaan: elemen yang fokus saat sheet terbuka). */
  returnFocus?: HTMLElement | null | undefined;
  /** Pakai seluruh tinggi area terlihat (mis. di atas keyboard), bukan 90%. */
  fill?: boolean;
  /** Mode keyboard HP: tanpa pegangan, jarak 8, padding 6 16 10. */
  compact?: boolean;
  /** Id teks yang menjadi deskripsi dialog (mis. keadaan kosong). */
  describedBy?: string | undefined;
  /** Klik di dalam sheet (fase capture), mis. untuk telemetri; tidak mengubah perilaku sheet. */
  onClickCapture?: MouseEventHandler<HTMLDivElement> | undefined;
  children: ReactNode;
}) {
  const vvHeight = useVisualViewportHeight(open);
  // Pemicu dikendalikan dari luar (bukan Dialog.Trigger), jadi fokus dikembalikan manual.
  const returnFocusTo = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-scrim data-[state=open]:animate-fade-in" />
        <Dialog.Content
          aria-describedby={describedBy}
          data-ruang={tint}
          data-compact={compact ? '' : undefined}
          onClickCapture={onClickCapture}
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
            // (mis. menu jenis, halaman kategori) menandai dirinya agar sheet tidak ikut tertutup.
            if (e.target instanceof Element && e.target.closest('[data-own-escape]')) {
              e.preventDefault();
            }
          }}
          onKeyDown={(e) => {
            // Radix memasang pendengar Escape hanya untuk lapisan teratas, dan sheet baru menjadi
            // teratas satu render sesudah fokus awalnya bila lapisan lain (toast) sudah ada. Escape
            // di celah itu jatuh ke toast dan sheet tetap terbuka. Cadangan: Escape dari dalam sheet
            // yang belum ditangani lapisan mana pun menutup sheet.
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            if (e.target instanceof Element && e.target.closest('[data-own-escape]')) return;
            e.preventDefault();
            onOpenChange(false);
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocusTo.current?.focus();
          }}
          style={vvHeight === null ? undefined : { maxHeight: fill ? vvHeight : vvHeight * 0.9 }}
          className={SHEET_PANEL}
        >
          {compact ? null : <span aria-hidden="true" className={SHEET_HANDLE} />}
          <header
            className={`relative flex items-center gap-2 px-4 ${compact ? 'pt-1' : 'pt-2 tablet:px-6 tablet:pt-6'}`}
          >
            {headerStart}
            <Dialog.Title
              className={
                titleHidden
                  ? 'sr-only'
                  : 'mr-auto flex min-w-0 items-center gap-2 text-heading font-extrabold'
              }
            >
              {titleContent ?? title}
            </Dialog.Title>
            {titleHidden ? <span className="mr-auto" /> : null}
            {headerAction}
            <Dialog.Close asChild>
              <IconButton label="Tutup" icon={<XIcon size={18} weight="bold" />} />
            </Dialog.Close>
          </header>
          <div
            style={
              footer === undefined
                ? { paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }
                : undefined
            }
            className={`flex min-h-0 flex-1 flex-col overflow-y-auto px-4 ${
              compact ? 'gap-2 pt-1.5' : 'gap-3 pt-3 tablet:px-6'
            }`}
          >
            {children}
          </div>
          {footer === undefined ? null : (
            <div
              style={{
                paddingBottom: compact
                  ? 'max(0.5rem, env(safe-area-inset-bottom))'
                  : 'max(1rem, env(safe-area-inset-bottom))',
              }}
              className={`flex flex-col gap-2 px-4 ${compact ? 'pt-2' : 'pt-3 tablet:px-6 tablet:pb-6'}`}
            >
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
