'use client';

import { useMemo } from 'react';
import type { Ruang } from '@/features/ledger/types';
import { MoveSheet, type MoveSheetProps, type MoveSource } from '@/features/catat/move-sheet';
import { moveEntryAction, moveTargetsAction } from '../_actions/entri';

/**
 * Sheet Pindahkan mode nyata (dimuat malas saat Pindahkan pertama dipakai): sumber = Server Action
 * ruang ini. Pilihan ruang tujuan diminta lewat `moveTargetsAction` saat sheet dibuka (R27), tidak
 * pernah lewat props RSC. Fetch action yang putus = `network` (clientId yang sama dipakai lagi).
 */
export function realMoveSource(ruang: Ruang): MoveSource {
  return {
    async targets(toRuang) {
      try {
        return await moveTargetsAction(ruang, toRuang);
      } catch {
        return { ok: false, error: { code: 'network' } };
      }
    },
    async move(req) {
      try {
        return await moveEntryAction(ruang, req);
      } catch {
        return { ok: false, error: { code: 'network' } };
      }
    },
  };
}

export function MoveSheetReal(props: Omit<MoveSheetProps, 'source'>) {
  const source = useMemo(() => realMoveSource(props.ruang), [props.ruang]);
  return <MoveSheet {...props} source={source} />;
}
