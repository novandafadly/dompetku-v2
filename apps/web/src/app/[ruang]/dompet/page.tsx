'use client';

import { useState } from 'react';
import { AccountList } from '@/features/dompet/account-list';
import { AddAccountSheet } from '@/features/dompet/add-account-sheet';
import { useDemo } from '@/features/shell/demo-provider';

export default function DompetPage() {
  const { state, store, ruang, today, accountHref } = useDemo();
  const [adding, setAdding] = useState(false);
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
      <AddAccountSheet
        open={adding}
        onOpenChange={setAdding}
        state={state}
        store={store}
        ruang={ruang}
        today={today}
      />
    </>
  );
}
