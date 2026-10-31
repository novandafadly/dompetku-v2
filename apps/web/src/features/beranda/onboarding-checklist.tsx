'use client';

import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { CaretRightIcon } from '@/components/ui/icons/caret-right';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { FlagBannerIcon } from '@/components/ui/icons/flag-banner';
import { card, focusRing, rowDivider } from '@/components/ui/styles';
import type { BerandaContext } from './context';

interface Step {
  key: string;
  done: boolean;
  label: string;
  /** Langkah yang belum selesai: tautan atau tombol 56 px dengan caret. */
  action?:
    | { kind: 'button'; onClick: () => void; onIntent?: (() => void) | undefined }
    | { kind: 'link'; href: Route };
}

const stepRow = `flex min-h-14 w-full items-center gap-3 text-left text-body font-semibold text-text`;

function Circle() {
  return (
    <span aria-hidden="true" className="size-6 shrink-0 rounded-full border-2 border-border" />
  );
}

function StepContent({ step }: { step: Step }): ReactNode {
  if (step.done) {
    return (
      <span className={stepRow}>
        <CheckCircleIcon size={24} weight="fill" className="shrink-0 text-accent-text" />
        <span className="flex-1">{step.label}</span>
        <span className="text-label font-medium text-text-muted">Selesai</span>
      </span>
    );
  }
  const inner = (
    <>
      <Circle />
      <span className="flex-1">{step.label}</span>
      <span className="sr-only">Belum</span>
      <CaretRightIcon size={16} weight="bold" className="shrink-0 text-text-muted" />
    </>
  );
  const interactive = `${stepRow} -mx-4 px-4 hover-pointer:bg-hover ${focusRing}`;
  if (step.action?.kind === 'link') {
    return (
      <Link href={step.action.href} className={interactive}>
        {inner}
      </Link>
    );
  }
  if (step.action?.kind === 'button') {
    const { onClick, onIntent } = step.action;
    return (
      <button
        type="button"
        onClick={onClick}
        onPointerEnter={onIntent}
        onFocus={onIntent}
        className={interactive}
      >
        {inner}
      </button>
    );
  }
  return <span className={stepRow}>{inner}</span>;
}

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

  const steps: Step[] = [
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
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section aria-labelledby="mulai" className={`flex flex-col px-4 pt-3.5 pb-1 ${card}`}>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h2 id="mulai" className="flex items-center gap-2 text-label font-bold text-text-soft">
          <FlagBannerIcon size={18} className="shrink-0" />
          Mulai dari sini
        </h2>
        <span className="text-caption font-medium text-text-muted">
          {`${String(doneCount)} dari ${String(steps.length)} selesai`}
        </span>
      </div>
      {ruang === 'bersama' ? (
        <p className="pt-1 text-label font-medium text-text-soft">
          Pengeluaran rumah tangga yang kalian bagi. Farida dan kamu sama-sama bisa mencatat dan
          mengubah di sini.
        </p>
      ) : null}
      <ul aria-label="Mulai dari sini">
        {steps.map((s) => (
          <li key={s.key} className={rowDivider}>
            <StepContent step={s} />
          </li>
        ))}
      </ul>
    </section>
  );
}
