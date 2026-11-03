'use client';

import { isoAtWIB, nowIsoWIB } from '@dompetku/domain';
import type { IsoDate } from '@dompetku/domain';
import { createDemoStore, createSeed } from '@dompetku/demo-data';
import type { DemoStore, Ruang } from '@dompetku/demo-data';
import { useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { DemoContext, type DataState } from './demo-context';
import { RencanaContext } from './rencana-context';
import { useNav } from './nav-provider';

/**
 * Jam toko demo: tanggal mengikuti `today`, jam mengikuti WIB sekarang. Entri baru tidak
 * boleh terurut di bawah entri yang sudah ada di hari yang sama (jam seed bisa lebih
 * larut dari jam sekarang), jadi hasilnya minimal satu detik setelah createdAt terbaru.
 */
function demoClock(today: IsoDate, store: () => DemoStore): () => string {
  return () => {
    const candidate = isoAtWIB(today);
    let latest = '';
    for (const e of store().getState().entries) if (e.createdAt > latest) latest = e.createdAt;
    if (candidate > latest) return candidate;
    return nowIsoWIB(new Date(Date.parse(latest) + 1000));
  };
}

/**
 * Seed + store demo. Dipasang di dalam NavProvider (Suspense-nya sudah menutup pembacaan
 * `useSearchParams`), hanya lewat `DemoRoot` (muat malas): modul ini membawa seed demo, jadi tidak
 * boleh diimpor statis dari modul yang ikut mode nyata. Layar membaca store lewat `useDemo`.
 */
export function DemoProvider({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const { today, dropParam } = useNav();
  // Query dibaca sekali saat mount; navigasi berikutnya tidak membuat ulang store.
  const [boot] = useState(() => {
    const variant = params.get('seed') === 'empty' ? 'empty' : 'full';
    const keypad = params.get('keypad') === 'app' ? 'app' : 'os';
    const store: DemoStore = createDemoStore(createSeed({ today, variant }), {
      clock: demoClock(today, () => store),
    });
    // Anggaran dan tagihan tidak berubah selama sesi demo, jadi Rencana cukup dihitung sekali.
    const { budgets, bills } = store.getState();
    const has = (r: Ruang) =>
      budgets.some((b) => b.ruang === r) || bills.some((b) => b.ruang === r);
    return {
      keypad,
      store,
      rencana: { pribadi: has('pribadi'), bersama: has('bersama') },
    } as const;
  });
  const [dataState, setDataState] = useState<DataState>(() => {
    const raw = params.get('state');
    return raw === 'loading' || raw === 'error' ? raw : 'ready';
  });
  const retry = () => {
    setDataState('ready');
    dropParam('state');
  };

  return (
    <DemoContext.Provider value={{ store: boot.store, keypad: boot.keypad, dataState, retry }}>
      <RencanaContext.Provider value={boot.rencana}>{children}</RencanaContext.Provider>
    </DemoContext.Provider>
  );
}
