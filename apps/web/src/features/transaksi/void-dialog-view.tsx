'use client';

import { formatRupiah } from '@dompetku/domain';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ArrowCounterClockwiseIcon } from '@/components/ui/icons/arrow-counter-clockwise';
import type { EntryVM } from '@/features/ledger/types';

/**
 * Akibat ke saldo bila transaksi dibatalkan (`EntryVM`, mode nyata). Kalimat sama dengan versi demo
 * (`voidSentence`); kaki antar ruang hanya menyebut dompet ruang ini (dompet lawan di ruang lain
 * tidak pernah dimuat).
 */
export function voidSentenceVM(e: EntryVM): string {
  const amt = formatRupiah(e.amount);
  const own = e.accountName;
  let effect: string;
  switch (e.kind) {
    case 'expense':
      effect = `Saldo ${own} bertambah ${amt}.`;
      break;
    case 'transfer':
      effect = `Saldo ${own} bertambah ${amt}, saldo ${e.counterAccountName ?? ''} berkurang ${amt}.`;
      break;
    case 'space_transfer':
    case 'adjustment':
      effect =
        e.direction === 'out' ? `Saldo ${own} bertambah ${amt}.` : `Saldo ${own} berkurang ${amt}.`;
      break;
    default:
      effect = `Saldo ${own} berkurang ${amt}.`;
  }
  return `Transaksi ${amt} dibatalkan. ${effect} Bisa dipulihkan 90 hari dari Sampah.`;
}

/** Toast sesudah batal (pola toast Catat): "Dibatalkan di Pribadi · Rp 35.000 dari BCA". */
export function voidedToastVM(ruang: string, e: EntryVM): string {
  const head = `Dibatalkan di ${ruang} · ${formatRupiah(e.amount)}`;
  switch (e.kind) {
    case 'income':
      return `${head} ke ${e.accountName}`;
    case 'transfer':
      return `${head} dari ${e.accountName} ke ${e.counterAccountName ?? ''}`;
    default:
      return `${head} dari ${e.accountName}`;
  }
}

/** Dialog Batalkan (D2): salinan tetap, fokus awal di `Kembali` (ConfirmDialog). */
export function VoidDialogView({
  open,
  onOpenChange,
  onConfirm,
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  description: string;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<ArrowCounterClockwiseIcon size={22} weight="bold" />}
      title="Batalkan transaksi ini?"
      description={description}
      confirmLabel="Batalkan transaksi"
      cancelLabel="Kembali"
      onConfirm={onConfirm}
    />
  );
}
