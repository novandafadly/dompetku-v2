'use client';

import { useMemo } from 'react';
import { EditSheet, type EditSheetProps, type EditSource } from '@/features/catat/edit-sheet';
import type { Ruang } from '@/features/ledger/types';
import { reloadEntry, updateEntryAction } from '../_actions/entri';

/**
 * Sheet Ubah mode nyata (dimuat malas saat Ubah pertama dipakai): sumber = Server Action ruang ini
 * (`updateEntryAction`, `reloadEntry`). Fetch action yang putus = `network` ("Coba lagi" dengan
 * clientId yang sama), tidak pernah melempar ke sheet.
 */
export function realEditSource(ruang: Ruang): EditSource {
  return {
    async update(input) {
      try {
        return await updateEntryAction(ruang, input);
      } catch {
        return { ok: false, error: { code: 'network' } };
      }
    },
    async reload(entryId) {
      try {
        return await reloadEntry(ruang, entryId);
      } catch {
        return { ok: false, error: { code: 'network' } };
      }
    },
  };
}

export function EditSheetReal(props: Omit<EditSheetProps, 'source'>) {
  const source = useMemo(() => realEditSource(props.ruang), [props.ruang]);
  return <EditSheet {...props} source={source} />;
}
