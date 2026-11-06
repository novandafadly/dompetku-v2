'use client';

import type { Ruang } from '@dompetku/demo-data';
import { createContext } from 'react';

/**
 * Ruang yang punya anggaran atau tagihan. Hanya DemoProvider yang mengisinya (prototipe: tab
 * tersembunyi bila kosong). Mode nyata tidak punya provider, jadi nilai bawaan berlaku: tab
 * Rencana selalu tampil (K8 S9; ruang kosong mendapat ajakan di halamannya). Modul sendiri (bukan
 * di `nav-items`) supaya chunk muat malas DemoProvider tidak menyalin ikon navigasi (ADR 0002).
 */
export const RencanaContext = createContext<Record<Ruang, boolean>>({
  pribadi: true,
  bersama: true,
});
