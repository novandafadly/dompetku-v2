'use client';

import { notFound, useParams } from 'next/navigation';
import { useDemo } from '@/features/shell/demo-provider';
import { EntryDetail } from '@/features/transaksi/entry-detail';

export default function TransaksiDetailPage() {
  const { state, store, ruang, today, href, entryHref } = useDemo();
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const entry = state.entries.find((e) => e.id === id && e.ruang === ruang);
  if (entry === undefined) notFound();
  return (
    <EntryDetail
      entry={entry}
      state={state}
      store={store}
      ruang={ruang}
      today={today}
      listHref={href(ruang, 'transaksi')}
      entryHref={(eid) => entryHref(ruang, eid)}
    />
  );
}
