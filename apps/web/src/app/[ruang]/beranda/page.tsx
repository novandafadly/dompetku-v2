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
      <>
        {checklist}
        {sheet}
      </>
    );
  }
  return (
    <>
      <SafeToSpend {...demo} />
      {hasExpense ? null : <div className="mt-8">{checklist}</div>}
      <BillsSoon {...demo} />
      <BudgetsNearLimit {...demo} />
      <RecentEntries {...demo} />
      {ruang === 'bersama' ? <ActivityFeed {...demo} /> : null}
      {sheet}
    </>
  );
}
