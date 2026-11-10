'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { CaretLeftIcon } from '@/components/ui/icons/caret-left';
import { focusRing } from '@/components/ui/styles';
import type { Ruang } from '@/features/ledger/types';
import { buildHref } from '@/features/shell/hrefs';
import { useNav } from '@/features/shell/nav-provider';
import { WaLinkView, type WaViewStatus } from '@/features/wa/wa-link-view';
import { createLinkCode, unlinkWa } from '../_actions/wa';

/** Pulau klien WhatsApp (dimuat malas lewat `whatsapp-islands`): mengikat Server Action ke tampilan. */

export function WhatsappManager({ status }: { status: WaViewStatus }) {
  const router = useRouter();
  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);
  return (
    <WaLinkView status={status} createCode={createLinkCode} unlink={unlinkWa} refresh={refresh} />
  );
}

export function WhatsappBack({ ruang }: { ruang: Ruang }) {
  const router = useRouter();
  const nav = useNav();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(buildHref(ruang, 'beranda', nav.query));
      }}
      className={`-ml-1 inline-flex min-h-11 items-center gap-1.5 self-start rounded-md px-1 text-body font-bold text-accent-text hover-pointer:underline ${focusRing}`}
    >
      <CaretLeftIcon size={16} weight="bold" />
      Menu
    </button>
  );
}
