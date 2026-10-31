'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { IconProps } from './icon';

type IconMap = typeof import('./category-icon-map');

// Peta ±25 ikon kategori dimuat setelah hidrasi (batas JS 162 kB, ADR 0002). Ubin ikon sudah
// berukuran tetap, jadi ikon yang menyusul tidak menggeser tata letak.
let loaded: IconMap | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load() {
  pending ??= import('./category-icon-map').then((m) => {
    loaded = m;
    listeners.forEach((l) => {
      l();
    });
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useIconMap(): IconMap | null {
  const map = useSyncExternalStore(
    subscribe,
    () => loaded,
    () => null,
  );
  useEffect(load, []);
  return map;
}

function Blank({ size = 20 }: { size?: number | undefined }) {
  return <span aria-hidden="true" className="inline-block" style={{ width: size, height: size }} />;
}

/** Ikon kategori (handoff: Assets); entri tanpa kategori memakai ikon jenisnya. */
export function CategoryIcon({
  name,
  kind,
  ...props
}: IconProps & { name?: string | undefined; kind?: string }) {
  const map = useIconMap();
  if (map === null) return <Blank size={props.size} />;
  return map.renderCategoryIcon(name, kind, props);
}

/** Ikon tipe dompet: bank, tunai, e-wallet. */
export function WalletTypeIcon({
  type,
  ...props
}: IconProps & { type: 'bank' | 'cash' | 'ewallet' }) {
  const map = useIconMap();
  if (map === null) return <Blank size={props.size} />;
  return map.renderWalletIcon(type, props);
}
