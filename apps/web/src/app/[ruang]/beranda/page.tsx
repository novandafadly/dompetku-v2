'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { ActivityFeed } from '@/features/beranda/activity-feed';
import { BillsSoon } from '@/features/beranda/bills-soon';
import { BudgetsNearLimit } from '@/features/beranda/budgets-near-limit';
import { OnboardingChecklist } from '@/features/beranda/onboarding-checklist';
import { RecentEntries } from '@/features/beranda/recent-entries';
import { SafeToSpend } from '@/features/beranda/safe-to-spend';
import { useOpenCatat, usePreloadCatat } from '@/features/shell/catat';
import { useDemo } from '@/features/shell/demo-provider';

const AddAccountSheet = dynamic(
  () => import('@/features/dompet/add-account-sheet').then((m) => m.AddAccountSheet),
  { ssr: false },
);

export default function BerandaPage() {
  const demo = useDemo();
  const openCatat = useOpenCatat();
  const preloadCatat = usePreloadCatat();
  const [adding, setAdding] = useState(false);
  const addMounted = useOpenedOnce(adding);
  const { state, store, ruang, today, authHref } = demo;
  const hasOperasional = state.accounts.some(
    (a) => a.ruang === ruang && a.pocket === 'operasional',
  );
  const hasExpense = state.entries.some(
    (e) => e.ruang === ruang && e.kind === 'expense' && e.voidedAt === undefined,
  );
  const checklist = (
    <OnboardingChecklist
      state={state}
      ruang={ruang}
      undangHref={authHref('undang')}
      onAddWallet={() => {
        setAdding(true);
      }}
      onCatatIntent={preloadCatat}
      onCatat={() => {
        openCatat();
      }}
    />
  );
  const sheet = addMounted ? (
    <AddAccountSheet
      open={adding}
      onOpenChange={setAdding}
      state={state}
      store={store}
      ruang={ruang}
      today={today}
    />
  ) : null;
  if (!hasOperasional) {
    return (
      <div className="mx-auto max-w-2xl">
        {checklist}
        {sheet}
      </div>
    );
  }

  // Tiga keadaan: satu kolom (< 768), daftar berpasangan di bawah kartu (768-1023),
  // dua kolom kartu | daftar (>= 1024, spec R12).
  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
      <div className="flex flex-col gap-8">
        <SafeToSpend {...demo} />
        {hasExpense ? null : checklist}
      </div>
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-1">
        <BillsSoon {...demo} />
        <BudgetsNearLimit {...demo} />
        <div className="md:col-span-2 lg:col-span-1">
          <RecentEntries {...demo} />
        </div>
        {ruang === 'bersama' ? (
          <div className="md:col-span-2 lg:col-span-1">
            <ActivityFeed {...demo} />
          </div>
        ) : null}
      </div>
      {sheet}
    </div>
  );
}
