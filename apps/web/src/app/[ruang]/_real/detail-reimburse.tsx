'use client';

import { useMemo } from 'react';
import { newClientId } from '@/features/catat/client-id';
import type { Ruang } from '@/features/ledger/types';
import {
  NotReimbursedDialog,
  ReimburseSheet,
  type ReimburseSheetProps,
  type ReimburseSource,
} from '@/features/catat/reimburse-sheet';
import { updateEntryAction, voidEntryAction } from '../_actions/entri';
import { createReimbursementAction } from '../_actions/reimburse';

/**
 * Sheet `Catat reimburse` dan dialog `Tidak diganti` mode nyata (dimuat malas): sumber = Server
 * Action ruang ini (Pribadi). Fetch action yang putus = `network`.
 */
export function realReimburseSource(ruang: Ruang): ReimburseSource {
  return {
    async create(req) {
      try {
        const res = await createReimbursementAction(ruang, req);
        return res.ok ? { ok: true, value: { entryId: res.value.entryId } } : res;
      } catch {
        return { ok: false, error: { code: 'network' } };
      }
    },
    async undo(entryId) {
      try {
        // Reimburse yang baru dicatat selalu versi 1.
        const res = await voidEntryAction(ruang, {
          clientId: newClientId(),
          entryId,
          expectedVersion: 1,
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    async notReimbursed({ clientId, entry }) {
      try {
        // Ganti-penuh dengan nilai sekarang, hanya `reimbursable` yang berubah.
        return await updateEntryAction(ruang, {
          clientId,
          entryId: entry.id,
          expectedVersion: entry.version,
          accountId: entry.accountId,
          amount: entry.amount,
          categoryId: entry.categoryId ?? null,
          occurredOn: null,
          description: entry.description ?? null,
          reimbursable: false,
        });
      } catch {
        return { ok: false, error: { code: 'network' } };
      }
    },
  };
}

export function ReimburseSheetReal(props: Omit<ReimburseSheetProps, 'source'> & { ruang: Ruang }) {
  const { ruang, ...rest } = props;
  const source = useMemo(() => realReimburseSource(ruang), [ruang]);
  return <ReimburseSheet {...rest} source={source} />;
}

export function NotReimbursedDialogReal(
  props: Omit<Parameters<typeof NotReimbursedDialog>[0], 'source'> & { ruang: Ruang },
) {
  const { ruang, ...rest } = props;
  const source = useMemo(() => realReimburseSource(ruang), [ruang]);
  return <NotReimbursedDialog {...rest} source={source} />;
}
