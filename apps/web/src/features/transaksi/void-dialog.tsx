'use client';

import type { DemoState, Entry } from '@dompetku/demo-data';
import { formatRupiah } from '@dompetku/domain';
import { accountName } from './filters';
import { VoidDialogView } from './void-dialog-view';

/** Akibat ke saldo bila transaksi dibatalkan, dalam kalimat utuh. */
export function voidSentence(state: DemoState, e: Entry): string {
  const amt = formatRupiah(e.amount);
  const own = accountName(state, e.accountId);
  let effect: string;
  switch (e.kind) {
    case 'expense':
      effect = `Saldo ${own} bertambah ${amt}.`;
      break;
    case 'transfer':
      effect = `Saldo ${own} bertambah ${amt}, saldo ${accountName(state, e.counterAccountId ?? '')} berkurang ${amt}.`;
      break;
    case 'space_transfer': {
      const other = state.entries.find((x) => x.linkId === e.linkId && x.id !== e.id);
      effect =
        e.direction === 'in' || other === undefined
          ? `Saldo ${own} berkurang ${amt}.`
          : `Saldo ${own} bertambah ${amt}, saldo ${accountName(state, other.accountId)} berkurang ${amt}.`;
      break;
    }
    default:
      effect = `Saldo ${own} berkurang ${amt}.`;
  }
  return `Transaksi ${amt} dibatalkan. ${effect} Bisa dipulihkan 90 hari dari Sampah.`;
}

/** Pembungkus demo: kalimat dari store demo, dialog `VoidDialogView` (sama dengan mode nyata). */
export function VoidDialog({
  state,
  entry,
  open,
  onOpenChange,
  onConfirm,
}: {
  state: DemoState;
  entry: Entry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <VoidDialogView
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      description={voidSentence(state, entry)}
    />
  );
}
