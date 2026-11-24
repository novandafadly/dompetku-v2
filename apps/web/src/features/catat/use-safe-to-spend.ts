import type { IsoDate } from '@dompetku/domain';
import { useEffect, useState } from 'react';
import type { Ruang } from '@/features/ledger/types';
import { isPromise, type CatatSafe, type CatatSource } from './source';

/**
 * Aman dipakai ruang `ruang` untuk baris konteks sheet. Hanya selama `enabled`; gagal atau tanpa
 * sumber = `null` (baris tidak tampil, Catat tidak terhalang). Hasil milik ruang lain tidak
 * pernah dipakai: angka disimpan bersama ruangnya dan dibuang bila ruang sheet berganti.
 */
export function useSafeToSpend(
  source: CatatSource,
  ruang: Ruang,
  today: IsoDate,
  enabled: boolean,
): CatatSafe | null {
  const [state, setState] = useState<{ ruang: Ruang; safe: CatatSafe | null } | null>(null);

  useEffect(() => {
    if (!enabled || source.safeToSpend === undefined) return;
    let live = true;
    const done = (safe: CatatSafe | null) => {
      if (live) setState({ ruang, safe });
    };
    try {
      const r = source.safeToSpend(ruang, today);
      if (isPromise(r))
        r.then(done, () => {
          done(null);
        });
      else done(r);
    } catch {
      done(null);
    }
    return () => {
      live = false;
    };
  }, [source, ruang, today, enabled]);

  return enabled && state !== null && state.ruang === ruang ? state.safe : null;
}
