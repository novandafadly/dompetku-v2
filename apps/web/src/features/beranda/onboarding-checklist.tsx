'use client';

import type { Route } from 'next';
import type { BerandaContext } from './context';
import { OnboardingChecklistView, type ChecklistStep } from './onboarding-checklist-view';

/** Pembungkus prototipe: langkah dari store demo. */
export function OnboardingChecklist({
  state,
  ruang,
  undangHref,
  onAddWallet,
  onCatat,
  onCatatIntent,
}: Pick<BerandaContext, 'state' | 'ruang'> & {
  undangHref: Route;
  onAddWallet: () => void;
  onCatat: () => void;
  /** Pointer/fokus di tombol Catat: mulai memuat kode sheet. */
  onCatatIntent?: () => void;
}) {
  const walletDone = state.accounts.some((a) => a.ruang === ruang && a.pocket === 'operasional');
  const entryDone = state.entries.some(
    (e) => e.ruang === ruang && e.kind === 'expense' && e.voidedAt === undefined,
  );

  const steps: ChecklistStep[] = [
    { key: 'aman', done: true, label: 'Akun aman' },
    {
      key: 'dompet',
      done: walletDone,
      label: ruang === 'bersama' ? 'Buat dompet bersama' : 'Tambah dompet sehari-hari',
      action: { kind: 'button', onClick: onAddWallet },
    },
    {
      key: 'catat',
      done: entryDone,
      label: 'Catat satu pengeluaran',
      action: { kind: 'button', onClick: onCatat, onIntent: onCatatIntent },
    },
  ];
  if (ruang === 'pribadi') {
    steps.push({
      key: 'undang',
      done: false,
      label: 'Undang Farida',
      action: { kind: 'link', href: undangHref },
    });
  }
  return <OnboardingChecklistView ruang={ruang} steps={steps} />;
}
