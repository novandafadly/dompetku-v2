'use client';

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useToasts } from './toast-store';
import { useOpenedOnce } from './use-opened-once';

export { toast, type ToastInput } from './toast-store';

// Tampilan toast (Radix Toast) dimuat saat toast pertama muncul; wilayah dan live region-nya
// selalu terpasang supaya pembaca layar sudah mengenalnya sebelum toast pertama.
const ToastList = lazy(() => import('./toast-list').then((m) => ({ default: m.ToastList })));

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
        className="fixed inset-x-3 bottom-toast z-50 outline-none laptop:inset-x-auto laptop:right-6 laptop:bottom-6 laptop:w-100"
      >
        {mounted && announcer ? (
          <Suspense fallback={null}>
            <ToastList announcer={announcer} />
          </Suspense>
        ) : null}
      </section>
    </>
  );
}
