'use client';

import { useState } from 'react';
import { ActivityFeed } from '@/features/beranda/activity-feed';
import { BillsSoon } from '@/features/beranda/bills-soon';
import { BudgetsNearLimit } from '@/features/beranda/budgets-near-limit';
import { OnboardingChecklist } from '@/features/beranda/onboarding-checklist';
import { RecentEntries } from '@/features/beranda/recent-entries';
import { SafeToSpend } from '@/features/beranda/safe-to-spend';
import { AddAccountSheet } from '@/features/dompet/add-account-sheet';
import { useOpenCatat } from '@/features/shell/catat';
import { useDemo } from '@/features/shell/demo-provider';

export default function BerandaPage() {
  const demo = useDemo();
  const openCatat = useOpenCatat();
  const [adding, setAdding] = useState(false);
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
      onCatat={() => {
        openCatat();
      }}
    />
  );
  const sheet = (
    <AddAccountSheet
      open={adding}
      onOpenChange={setAdding}
      state={state}
      store={store}
      ruang={ruang}
      today={today}
    />
  );
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
