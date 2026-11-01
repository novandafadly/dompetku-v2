'use client';

import { notFound, useParams } from 'next/navigation';
import { AccountHistory } from '@/features/dompet/account-history';
import { useDemo } from '@/features/shell/demo-provider';

export function DompetRiwayatPage() {
  const { state, ruang, today, href, entryHref } = useDemo();
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const account = state.accounts.find((a) => a.id === id && a.ruang === ruang);
  if (account === undefined) notFound();
  return (
    <AccountHistory
      state={state}
      ruang={ruang}
      today={today}
      account={account}
      dompetHref={href(ruang, 'dompet')}
      entryHref={(eid) => entryHref(ruang, eid)}
    />
  );
}
