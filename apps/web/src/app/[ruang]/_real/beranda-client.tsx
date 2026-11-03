'use client';

import { ChecklistStepButton } from '@/features/beranda/onboarding-checklist-view';
import { useOpenCatat, usePreloadCatat } from '@/features/shell/catat';

export { NoSpendButton } from '@/features/beranda/no-spend-button';

/** Langkah checklist "Catat satu pengeluaran" mode nyata: membuka sheet Catat (pulau klien kecil). */
export function CatatStep({ label }: { label: string }) {
  const openCatat = useOpenCatat();
  const preloadCatat = usePreloadCatat();
  return (
    <ChecklistStepButton
      label={label}
      onClick={() => {
        openCatat();
      }}
      onIntent={preloadCatat}
    />
  );
}
