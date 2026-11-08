'use client';

import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { CaretRightIcon } from '@/components/ui/icons/caret-right';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { FlagBannerIcon } from '@/components/ui/icons/flag-banner';
import { card, focusRing, rowDivider } from '@/components/ui/styles';
import type { Ruang } from '@/features/ledger/types';

export interface ChecklistStep {
  key: string;
  done: boolean;
  label: string;
  /**
   * Langkah yang belum selesai: tautan atau tombol 56 px dengan caret. `element` = baris
   * interaktif yang sudah dirangkai pemanggil (mis. `ChecklistStepButton` di dalam komponen klien
   * kecil, agar page server tidak perlu mengirim fungsi).
   */
  action?:
    | { kind: 'button'; onClick: () => void; onIntent?: (() => void) | undefined }
    | { kind: 'link'; href: Route }
    | { kind: 'element'; element: ReactNode };
}

const stepRow = `flex min-h-14 w-full items-center gap-3 text-left text-body font-semibold text-text`;

function Circle() {
  return (
    <span aria-hidden="true" className="size-6 shrink-0 rounded-full border-2 border-border" />
  );
}

function StepContent({ step }: { step: ChecklistStep }): ReactNode {
  if (step.done) {
    return (
      <span className={stepRow}>
        <CheckCircleIcon size={24} weight="fill" className="shrink-0 text-accent-text" />
        <span className="flex-1">{step.label}</span>
        <span className="text-label font-medium text-text-muted">Selesai</span>
      </span>
    );
  }
  if (step.action?.kind === 'element') return step.action.element;
  if (step.action?.kind === 'link') {
    return (
      <Link href={step.action.href} className={interactive}>
        <StepInner label={step.label} />
      </Link>
    );
  }
  if (step.action?.kind === 'button') {
    const { onClick, onIntent } = step.action;
    return <ChecklistStepButton label={step.label} onClick={onClick} onIntent={onIntent} />;
  }
  return (
    <span className={stepRow}>
      <StepInner label={step.label} />
    </span>
  );
}

const interactive = `${stepRow} -mx-4 px-4 hover-pointer:bg-hover ${focusRing}`;

function StepInner({ label }: { label: string }) {
  return (
    <>
      <Circle />
      <span className="flex-1">{label}</span>
      <span className="sr-only">Belum</span>
      <CaretRightIcon size={16} weight="bold" className="shrink-0 text-text-muted" />
    </>
  );
}

/** Baris langkah belum selesai berupa tombol (56 px, caret). */
export function ChecklistStepButton({
  label,
  onClick,
  onIntent,
}: {
  label: string;
  onClick: () => void;
  /** Pointer/fokus di baris: mulai memuat kode yang akan dibuka. */
  onIntent?: (() => void) | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={onIntent}
      onFocus={onIntent}
      className={interactive}
    >
      <StepInner label={label} />
    </button>
  );
}

/** Checklist "Mulai dari sini" ber-prop langkah (pembungkus demo atau nyata menyusun langkahnya). */
export function OnboardingChecklistView({
  ruang,
  steps,
  intro,
  partnerName,
}: {
  ruang: Ruang;
  steps: ChecklistStep[];
  /** Pengantar Bersama pengganti bawaan (S7-B1: ruang baru berisi satu orang). */
  intro?: string;
  /** Anggota lain dari roster untuk pengantar bawaan (layar Farida: Novanda). */
  partnerName?: string;
}) {
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
          {intro ??
            `Pengeluaran yang kalian bagi. Kamu dan ${partnerName ?? 'pasangan'} sama-sama bisa mencatat dan mengubah di sini.`}
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
