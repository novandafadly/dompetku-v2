'use client';

import { fullDateLabel } from '@dompetku/domain';
import { lazy, Suspense, useState } from 'react';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { ActivityFeed } from '@/features/beranda/activity-feed';
import { BillsSoon } from '@/features/beranda/bills-soon';
import { BudgetsNearLimit } from '@/features/beranda/budgets-near-limit';
import { OnboardingChecklist } from '@/features/beranda/onboarding-checklist';
import { RecentEntries } from '@/features/beranda/recent-entries';
import { SafeToSpend, SafeToSpendEmpty } from '@/features/beranda/safe-to-spend';
import { useOpenCatat, usePreloadCatat } from '@/features/shell/catat';
import { useDemo } from '@/features/shell/demo-provider';
import { PageHeader } from '@/features/shell/page-header';

/**
 * Keadaan tinjauan `?state=loading|error` dimuat malas (pola Sampah): SSR tetap merender isinya
 * penuh, tetapi kerangka, ErrorState, dan ikonnya tidak ikut JS muat dingin Beranda (ADR 0002).
 */
const loadStates = () => import('@/features/beranda/beranda-states');
const BerandaLoading = lazy(() => loadStates().then((m) => ({ default: m.BerandaLoading })));
const BerandaError = lazy(() => loadStates().then((m) => ({ default: m.BerandaError })));

const AddAccountSheet = lazy(() =>
  import('@/features/dompet/add-account-sheet').then((m) => ({ default: m.DemoAddAccountSheet })),
);

export function BerandaPage() {
  const demo = useDemo();
  const openCatat = useOpenCatat();
  const preloadCatat = usePreloadCatat();
  const [adding, setAdding] = useState(false);
  const addMounted = useOpenedOnce(adding);
  const { state, store, ruang, today, authHref, href, entryHref, dataState, retry } = demo;
  const ctx = { state, store, ruang, today };
  const header = (
    <PageHeader
      title="Beranda"
      action={
        <span className="text-label font-semibold text-text-muted">{fullDateLabel(today)}</span>
      }
    />
  );

  if (dataState !== 'ready') {
    return (
      <>
        {header}
        <Suspense fallback={null}>
          {dataState === 'loading' ? (
            <BerandaLoading />
          ) : (
            <BerandaError
              onRetry={retry}
              onCatat={() => {
                openCatat();
              }}
            />
          )}
        </Suspense>
      </>
    );
  }

  const hasOperasional = state.accounts.some(
    (a) => a.ruang === ruang && a.pocket === 'operasional',
  );
  const hasExpense = state.entries.some(
    (e) => e.ruang === ruang && e.kind === 'expense' && e.voidedAt === undefined,
  );
  const addWallet = () => {
    setAdding(true);
  };
  const checklist = (
    <OnboardingChecklist
      state={state}
      ruang={ruang}
      undangHref={authHref('undang')}
      onAddWallet={addWallet}
      onCatatIntent={preloadCatat}
      onCatat={() => {
        openCatat();
      }}
    />
  );
  const recent = (
    <RecentEntries
      {...ctx}
      entryHref={(id) => entryHref(ruang, id)}
      listHref={href(ruang, 'transaksi')}
    />
  );
  const sheet = addMounted ? (
    <Suspense fallback={null}>
      <AddAccountSheet
        open={adding}
        onOpenChange={setAdding}
        state={state}
        store={store}
        ruang={ruang}
        today={today}
      />
    </Suspense>
  ) : null;

  if (!hasOperasional) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-3 laptop:max-w-180 laptop:gap-4">
          <SafeToSpendEmpty ruang={ruang} today={today} onAddWallet={addWallet} />
          {checklist}
          {recent}
        </div>
        {sheet}
      </>
    );
  }

  // HP: Aman → Tagihan → Anggaran → (Bersama) Aktivitas → Terakhir, satu kolom.
  // Tablet: Tagihan + Anggaran berdampingan. Laptop: keputusan di kiri, riwayat di kanan.
  return (
    <>
      {header}
      <div className="grid grid-cols-1 gap-3 tablet:gap-4 laptop:max-w-250 laptop:grid-cols-beranda laptop:items-start laptop:gap-5">
        <div className="flex flex-col gap-3 tablet:gap-4">
          <SafeToSpend {...ctx} />
          {hasExpense ? null : checklist}
          <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2 tablet:gap-4 laptop:grid-cols-autofit-260">
            <BillsSoon {...ctx} />
            <BudgetsNearLimit {...ctx} />
          </div>
        </div>
        <div className="flex flex-col gap-3 tablet:gap-4">
          {ruang === 'bersama' ? <ActivityFeed {...ctx} /> : null}
          {recent}
        </div>
      </div>
      {sheet}
    </>
  );
}
