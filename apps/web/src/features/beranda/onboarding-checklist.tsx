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
  undangHref,
  onAddWallet,
  onCatat,
}: Pick<BerandaContext, 'state' | 'ruang'> & {
  undangHref: Route;
  onAddWallet: () => void;
  onCatat: () => void;
}) {
  const walletDone = state.accounts.some((a) => a.ruang === ruang && a.pocket === 'operasional');
  const entryDone = state.entries.some(
    (e) => e.ruang === ruang && e.kind === 'expense' && e.voidedAt === undefined,
  );
  const Heading = walletDone ? 'h2' : 'h1';
  const linkClass = 'inline-flex min-h-11 items-center text-base font-medium text-accent underline';

  const steps: Step[] = [
    { key: 'aman', done: true, label: 'Akun aman' },
    {
      key: 'dompet',
      done: walletDone,
      label: (
        <Button
          variant="ghost"
          className="-ml-4 text-accent underline"
          onClick={() => {
            onAddWallet();
          }}
        >
          {ruang === 'bersama' ? 'Buat dompet bersama' : 'Tambah dompet sehari-hari'}
        </Button>
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
  if (ruang === 'pribadi') {
    steps.push({
      key: 'undang',
      done: false,
      label: (
        <Link href={undangHref} className={linkClass}>
          Undang Farida
        </Link>
      ),
    });
  }

  return (
    <section aria-labelledby="mulai">
      <Heading id="mulai" className="text-xl font-semibold text-accent">
        Mulai dari sini
      </Heading>
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
      {walletDone ? null : (
        <p className="mt-6 text-base text-text-muted">
          Tambahkan dompet operasional untuk melihat berapa yang aman dipakai bulan ini.
        </p>
      )}
    </section>
  );
}
