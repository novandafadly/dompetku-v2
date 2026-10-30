'use client';

import { ActivityFeed } from '@/features/beranda/activity-feed';
import { BillsSoon } from '@/features/beranda/bills-soon';
import { BudgetsNearLimit } from '@/features/beranda/budgets-near-limit';
import { OnboardingChecklist } from '@/features/beranda/onboarding-checklist';
import { RecentEntries } from '@/features/beranda/recent-entries';
import { SafeToSpend } from '@/features/beranda/safe-to-spend';
import { useOpenCatat } from '@/features/shell/catat';
import { useDemo } from '@/features/shell/demo-provider';

export default function BerandaPage() {
  const demo = useDemo();
  const openCatat = useOpenCatat();
  const { state, ruang } = demo;
  const hasOperasional = state.accounts.some(
    (a) => a.ruang === ruang && a.pocket === 'operasional',
  );
  if (!hasOperasional) {
    return (
      <OnboardingChecklist
        state={state}
        ruang={ruang}
        dompetHref={demo.href(ruang, 'dompet')}
        onCatat={() => {
          openCatat();
        }}
      />
    );
  }
  return (
    <>
      <SafeToSpend {...demo} />
      <BillsSoon {...demo} />
      <BudgetsNearLimit {...demo} />
      <RecentEntries {...demo} />
      {ruang === 'bersama' ? <ActivityFeed {...demo} /> : null}
    </>
  );
}
