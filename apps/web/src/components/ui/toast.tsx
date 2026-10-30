'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { useToasts } from './toast-store';
import { useOpenedOnce } from './use-opened-once';

export { toast, type ToastInput } from './toast-store';

// Tampilan toast (Radix Toast) dimuat saat toast pertama muncul; wilayah dan live region-nya
// selalu terpasang supaya pembaca layar sudah mengenalnya sebelum toast pertama.
const ToastList = dynamic(() => import('./toast-list').then((m) => m.ToastList), { ssr: false });

export function Toaster() {
  const mounted = useOpenedOnce(useToasts().length > 0);
  const regionRef = useRef<HTMLElement>(null);
  const [announcer, setAnnouncer] = useState<HTMLDivElement | null>(null);

  // F8 sebelum tampilan termuat: fokus ke wilayah (kosong). Setelahnya Radix yang menangani.
  useEffect(() => {
    if (mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F8') return;
      regionRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [mounted]);

  return (
    <>
      {/* Radix menaruh pengumuman tiap toast di sini (announcerContainer); di luar wilayah
          supaya teks toast tidak tampil dua kali di dalamnya. */}
      <div ref={setAnnouncer} aria-live="polite" className="sr-only" />
      <section
        ref={regionRef}
        aria-label="Notifikasi (F8)"
        tabIndex={-1}
        className="fixed inset-x-0 bottom-tabbar z-50 mx-auto w-full max-w-md outline-none lg:bottom-4"
      >
        {mounted && announcer ? <ToastList announcer={announcer} /> : null}
      </section>
    </>
  );
}
