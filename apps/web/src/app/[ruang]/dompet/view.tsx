'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { AccountList, AddWalletButton } from '@/features/dompet/account-list';
import { useDemo } from '@/features/shell/demo-provider';
import { PageHeader } from '@/features/shell/page-header';

const AddAccountSheet = dynamic(
  () => import('@/features/dompet/add-account-sheet').then((m) => m.AddAccountSheet),
  { ssr: false },
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
        <AddAccountSheet
          open={adding}
          onOpenChange={setAdding}
          state={state}
          store={store}
          ruang={ruang}
          today={today}
        />
      ) : null}
    </>
  );
}
