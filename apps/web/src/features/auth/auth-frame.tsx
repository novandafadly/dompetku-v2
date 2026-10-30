import type { ReactNode } from 'react';
import { DemoBanner } from '@/components/ui/demo-banner';

/** Rangka layar auth tiruan: di luar shell aplikasi, tanpa tab bar. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <DemoBanner />
      <main className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-hero text-2xl font-semibold text-accent">DompetKu</p>
          <p className="rounded-pill border border-warning px-3 py-1 text-sm font-semibold text-text">
            Prototipe — belum aktif
          </p>
        </div>
        {children}
      </main>
    </div>
  );
}
