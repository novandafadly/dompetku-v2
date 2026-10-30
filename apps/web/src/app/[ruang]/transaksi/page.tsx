'use client';

import { EntryList } from '@/features/transaksi/entry-list';
import { useDemo } from '@/features/shell/demo-provider';

export default function TransaksiPage() {
  const { state, store, ruang, today, href, entryHref, month, monthHref } = useDemo();
  return (
    <EntryList
      state={state}
      store={store}
      ruang={ruang}
      today={today}
      listHref={href(ruang, 'transaksi')}
      month={month}
      monthHref={(m) => monthHref(ruang, m)}
      entryHref={(id) => entryHref(ruang, id)}
    />
  );
}
