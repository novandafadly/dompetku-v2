'use client';

import { lazy, Suspense, useState } from 'react';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { AccountList, AddWalletButton } from '@/features/dompet/account-list';
import { useDemo } from '@/features/shell/demo-provider';
import { PageHeader } from '@/features/shell/page-header';

const AddAccountSheet = lazy(() =>
  import('@/features/dompet/add-account-sheet').then((m) => ({ default: m.AddAccountSheet })),
);

export function DompetPage() {
  const { state, store, ruang, today, accountHref } = useDemo();
  const [adding, setAdding] = useState(false);
  const addMounted = useOpenedOnce(adding);
  const add = () => {
    setAdding(true);
  };
  return (
    <>
      <PageHeader title="Dompet" action={<AddWalletButton onAdd={add} />} />
      <AccountList
        state={state}
        ruang={ruang}
        accountHref={(id) => accountHref(ruang, id)}
        onAdd={add}
      />
      {addMounted ? (
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
      ) : null}
    </>
  );
}
