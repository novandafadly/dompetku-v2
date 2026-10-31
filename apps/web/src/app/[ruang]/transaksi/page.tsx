'use client';

import { EntryList } from '@/features/transaksi/entry-list';
import { useDemo } from '@/features/shell/demo-provider';
import { PageHeader } from '@/features/shell/page-header';

export default function TransaksiPage() {
  const { state, store, ruang, today, href, entryHref, month, monthHref, dataState } = useDemo();
  return (
    <EntryList
      header={<PageHeader title="Transaksi" />}
      state={state}
      store={store}
      ruang={ruang}
      today={today}
      listHref={href(ruang, 'transaksi')}
      month={month}
      monthHref={(m) => monthHref(ruang, m)}
      entryHref={(id) => entryHref(ruang, id)}
      dataState={dataState}
    />
  );
}
