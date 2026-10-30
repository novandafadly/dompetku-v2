'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { AccountList } from '@/features/dompet/account-list';
import { useDemo } from '@/features/shell/demo-provider';

const AddAccountSheet = dynamic(
  () => import('@/features/dompet/add-account-sheet').then((m) => m.AddAccountSheet),
  { ssr: false },
);

export default function DompetPage() {
  const { state, store, ruang, today, accountHref } = useDemo();
  const [adding, setAdding] = useState(false);
  const addMounted = useOpenedOnce(adding);
  return (
    <>
      <AccountList
        state={state}
        ruang={ruang}
        accountHref={(id) => accountHref(ruang, id)}
        onAdd={() => {
          setAdding(true);
        }}
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
