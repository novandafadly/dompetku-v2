'use client';

import { lazy, type ReactNode } from 'react';

/**
 * Pintu masuk `DemoProvider` dari root layout, hanya di cabang prototipe (K3, ADR 0002). Impor
 * statis dari layout (Server Component) memasukkan modulnya ke JS muat awal setiap rute, termasuk
 * mode nyata, dan Turbopack ikut memasukkan `import()` dinamis di server. Batas muat malas di klien
 * memisahkan seed + store demo ke chunk sendiri yang hanya diminta bila cabang ini dirender.
 * SSR tetap merender isinya penuh; hidrasi prototipe menunggu chunk ini (satu permintaan sesudah
 * JS rute), jadi tes prototipe menghitungnya sebagai JS rute (`tests/e2e/route-scripts.ts`).
 * `React.lazy`, bukan `next/dynamic`: runtime `next/dynamic` menambah ±1,4 kB ke JS muat awal kedua
 * mode dan membuat Beranda prototipe melewati 162 kB.
 */
const Provider = lazy(() => import('./demo-provider').then((m) => ({ default: m.DemoProvider })));

/** Komponen fungsi (bukan objek lazy): ekspor modul klien yang dirender Server Component. */
export function DemoRoot({ children }: { children: ReactNode }) {
  return <Provider>{children}</Provider>;
}
