'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowClockwiseIcon } from '@/components/ui/icons/arrow-clockwise';
import { PlusIcon } from '@/components/ui/icons/plus';
import { useOpenCatat, usePreloadCatat } from '@/features/shell/catat';

/** Kosong pertama kali: membuka sheet Catat nyata (mekanisme buka Catat yang sama dengan shell). */
export function CatatEmpty() {
  const openCatat = useOpenCatat();
  const preloadCatat = usePreloadCatat();
  return (
    <Button
      onClick={() => {
        openCatat();
      }}
      onPointerEnter={preloadCatat}
      onFocus={preloadCatat}
    >
      <PlusIcon size={18} weight="bold" />
      Catat
    </Button>
  );
}

/** Gagal muat: render ulang page di server (`router.refresh`), sibuk selama transisi. */
export function Retry() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      loading={pending}
      onClick={() => {
        start(() => {
          router.refresh();
        });
      }}
    >
      {pending ? null : <ArrowClockwiseIcon size={18} weight="bold" />}
      Coba lagi
    </Button>
  );
}
