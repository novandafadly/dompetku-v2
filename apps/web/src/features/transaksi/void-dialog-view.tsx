'use client';

import { formatRupiah } from '@dompetku/domain';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ArrowCounterClockwiseIcon } from '@/components/ui/icons/arrow-counter-clockwise';
import type { EntryVM } from '@/features/ledger/types';
import { SAMPAH_HARI } from '@/features/ledger/sampah-window';

/**
 * Akibat ke saldo bila transaksi dibatalkan (`EntryVM`, mode nyata). Kalimat sama dengan versi demo
 * (`voidSentence`); kaki antar ruang hanya menyebut dompet ruang ini (dompet lawan di ruang lain
 * tidak pernah dimuat).
 */
export function voidSentenceVM(e: EntryVM): string {
  const amt = formatRupiah(e.amount);
  const own = e.accountName;
  // S7-D1: transfer antar ruang dibatalkan berpasangan; salinan tetap tanpa nama dompet ruang lain.
  if (e.kind === 'space_transfer') {
    return `Kedua sisinya dibatalkan bersamaan, di Pribadi dan Bersama. Saldo kedua dompet kembali. Bisa dipulihkan dari Sampah selama ${String(SAMPAH_HARI)} hari.`;
  }
  let effect: string;
  switch (e.kind) {
    case 'expense':
      effect = `Saldo ${own} bertambah ${amt}.`;
      break;
    case 'transfer':
      effect = `Saldo ${own} bertambah ${amt}, saldo ${e.counterAccountName ?? ''} berkurang ${amt}.`;
      break;
    case 'adjustment':
      effect =
        e.direction === 'out' ? `Saldo ${own} bertambah ${amt}.` : `Saldo ${own} berkurang ${amt}.`;
      break;
    case 'reimbursement':
      // S7-D3: membatalkan reimburse membuka lagi sisa talangan.
      effect = `Saldo ${own} berkurang ${amt}. Sisa talangan bertambah lagi.`;
      break;
    default:
      effect = `Saldo ${own} berkurang ${amt}.`;
  }
  return `Transaksi ${amt} dibatalkan. ${effect} Bisa dipulihkan ${String(SAMPAH_HARI)} hari dari Sampah.`;
}

/**
 * Toast sesudah batal (pola toast Catat): "Dibatalkan di Pribadi · Rp 35.000 dari BCA".
 * Reimburse masuk ke dompet ("ke"), antar ruang menyebut kedua ruang tanpa dompet (S7-D1).
 */
export function voidedToastVM(ruang: string, e: EntryVM): string {
  if (e.kind === 'space_transfer') {
    return `Dibatalkan di Pribadi dan Bersama · ${formatRupiah(e.amount)}`;
  }
  const head = `Dibatalkan di ${ruang} · ${formatRupiah(e.amount)}`;
  switch (e.kind) {
    case 'income':
    case 'reimbursement':
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
  title = 'Batalkan transaksi ini?',
  confirmLabel = 'Batalkan transaksi',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  description: string;
  /** Antar ruang (S7-D1): `Batalkan transfer antar ruang?` / `Batalkan transfer`. */
  title?: string;
  confirmLabel?: string;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<ArrowCounterClockwiseIcon size={22} weight="bold" />}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel="Kembali"
      onConfirm={onConfirm}
    />
  );
}
