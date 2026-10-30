'use client';

import { CheckCircleIcon, CircleIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { BerandaContext } from './context';

interface Step {
  key: string;
  done: boolean;
  label: ReactNode;
}

export function OnboardingChecklist({
  state,
  ruang,
  dompetHref,
  onCatat,
}: Pick<BerandaContext, 'state' | 'ruang'> & { dompetHref: Route; onCatat: () => void }) {
  const walletDone = state.accounts.some((a) => a.ruang === ruang);
  const entryDone = state.entries.some((e) => e.ruang === ruang && e.kind === 'expense');
  const linkClass = 'inline-flex min-h-11 items-center text-base font-medium text-accent underline';

  const steps: Step[] = [
    { key: 'aman', done: true, label: 'Akun aman' },
    {
      key: 'dompet',
      done: walletDone,
      label: (
        <Link href={dompetHref} className={linkClass}>
          {ruang === 'bersama' ? 'Buat dompet bersama' : 'Tambah dompet sehari-hari'}
        </Link>
      ),
    },
    {
      key: 'catat',
      done: entryDone,
      label: (
        <Button
          variant="ghost"
          className="-ml-4 text-accent underline"
          onClick={() => {
            onCatat();
          }}
        >
          Catat satu pengeluaran
        </Button>
      ),
    },
  ];
  if (ruang === 'pribadi') steps.push({ key: 'undang', done: false, label: 'Undang Farida' });

  return (
    <section aria-labelledby="mulai">
      <h1 id="mulai" className="text-xl font-semibold text-accent">
        Mulai dari sini
      </h1>
      {ruang === 'bersama' ? (
        <p className="mt-2 text-base text-text-muted">
          Pengeluaran rumah tangga yang kalian bagi. Farida dan kamu sama-sama bisa mencatat dan
          mengubah di sini.
        </p>
      ) : null}
      <ul aria-label="Mulai dari sini" className="mt-4">
        {steps.map((s) => (
          <li key={s.key} className="flex min-h-11 items-center gap-3 text-base text-text">
            {s.done ? (
              <CheckCircleIcon
                size={24}
                weight="fill"
                aria-hidden="true"
                className="shrink-0 text-income"
              />
            ) : (
              <CircleIcon size={24} aria-hidden="true" className="shrink-0 text-text-muted" />
            )}
            <span>{s.label}</span>
            <span className="sr-only">{s.done ? 'Selesai' : 'Belum'}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-base text-text-muted">
        Tambahkan dompet operasional untuk melihat berapa yang aman dipakai bulan ini.
      </p>
    </section>
  );
}
