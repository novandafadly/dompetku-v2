import type { ReactNode } from 'react';
import { WarningIcon } from '@phosphor-icons/react/dist/ssr/Warning';
import { DemoBanner } from '@/components/ui/demo-banner';

/** Rangka layar auth tiruan: di luar shell aplikasi, tanpa tab bar. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <DemoBanner />
      <main className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-8 sm:py-16">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-2xl font-bold text-text">DompetKu</p>
          <p className="flex items-center gap-1 text-sm font-semibold text-text-muted">
            <WarningIcon size={16} weight="fill" aria-hidden="true" className="text-warning" />
            Prototipe: belum aktif
          </p>
        </div>
        {children}
      </main>
    </div>
  );
}
