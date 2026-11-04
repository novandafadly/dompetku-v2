'use client';

import type { Ruang } from '@dompetku/demo-data';
import { createContext } from 'react';

/**
 * Ruang yang punya anggaran atau tagihan. Hanya DemoProvider yang mengisinya; mode nyata belum
 * punya halaman Rencana, jadi tab itu tersembunyi. Modul sendiri (bukan di `nav-items`) supaya
 * chunk muat malas DemoProvider tidak menyalin ikon navigasi (ADR 0002).
 */
export const RencanaContext = createContext<Record<Ruang, boolean>>({
  pribadi: false,
  bersama: false,
});
