'use client';

import { useState } from 'react';
import { buttonClass } from '@/components/ui/button';
import { CircleNotchIcon } from '@/components/ui/icons/circle-notch';
import { ExportIcon } from '@/components/ui/icons/export';
import { toast } from '@/components/ui/toast';
import type { Ruang } from '@/features/ledger/types';
import { EKSPOR_COPY } from './ekspor-copy';

/**
 * Tautan `Ekspor CSV` bergaya tombol (S10-EX1). Dasar: tautan unduh biasa (jalan tanpa JS). Dengan JS: `fetch` →
 * blob → unduh, supaya galat (terlalu besar, terlalu sering, jaringan) menjadi toast, bukan halaman
 * teks di tab. Berkas dinamai dari props (nama yang sama dengan header server), tanpa nama orang.
 */
export function ExportButton({
  ruang,
  href,
  filename,
  periodTitle,
  describedBy,
}: {
  ruang: Ruang;
  href: string;
  filename: string;
  /** `Oktober 2026`. */
  periodTitle: string;
  describedBy: string;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(href, { credentials: 'same-origin' });
      if (!res.ok) {
        toast({
          message:
            res.status === 429
              ? EKSPOR_COPY.errRate
              : res.status === 422
                ? EKSPOR_COPY.errTooLarge
                : EKSPOR_COPY.errGeneric,
          tone: 'info',
        });
        return;
      }
      // Sesi habis: fetch mengikuti redirect ke halaman masuk (200 HTML); jangan diunduh sebagai .csv.
      if (res.redirected || !(res.headers.get('content-type') ?? '').startsWith('text/csv')) {
        toast({ message: EKSPOR_COPY.errSession, tone: 'info' });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ message: EKSPOR_COPY.done(periodTitle, ruang) });
    } catch {
      toast({ message: EKSPOR_COPY.errGeneric, tone: 'info' });
    } finally {
      setBusy(false);
    }
  }

  return (
    // Tautan unduh biasa: tanpa JS (atau sebelum hidrasi) peramban mengunduh langsung dari server.
    <a
      href={href}
      download={filename}
      aria-describedby={describedBy}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      className={`${buttonClass('secondary')} w-full laptop:w-auto`}
      onClick={(e) => {
        e.preventDefault();
        void download();
      }}
    >
      {busy ? (
        <>
          <CircleNotchIcon size={18} weight="bold" className="shrink-0 motion-safe:animate-spin" />
          {EKSPOR_COPY.busy}
        </>
      ) : (
        <>
          <ExportIcon size={18} weight="bold" />
          {EKSPOR_COPY.button}
        </>
      )}
    </a>
  );
}
