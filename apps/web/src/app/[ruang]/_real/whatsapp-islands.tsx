'use client';

import { lazy, Suspense, type ComponentProps } from 'react';
import type { WhatsappBack, WhatsappManager } from './whatsapp-client';

/**
 * Pulau klien WhatsApp, dimuat malas (pola Kategori/Sampah): kodenya tidak ikut JS muat awal rute
 * lain (ADR 0002; Beranda nyata hampir di batas 162 kB).
 */

const load = () => import('./whatsapp-client');
const Manager = lazy(() => load().then((m) => ({ default: m.WhatsappManager })));
const Back = lazy(() => load().then((m) => ({ default: m.WhatsappBack })));

export function WhatsappManagerIsland(props: ComponentProps<typeof WhatsappManager>) {
  return (
    <Suspense fallback={null}>
      <Manager {...props} />
    </Suspense>
  );
}

export function WhatsappBackIsland(props: ComponentProps<typeof WhatsappBack>) {
  return (
    <Suspense fallback={null}>
      <Back {...props} />
    </Suspense>
  );
}
