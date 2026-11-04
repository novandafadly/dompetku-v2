'use client';

import { EntryList } from '@/features/transaksi/entry-list';
import { useDemo } from '@/features/shell/demo-context';
import { PageHeader } from '@/features/shell/page-header';

export function TransaksiPage() {
  const { state, store, ruang, today, href, entryHref, month, monthHref, sampahHref, dataState } =
    useDemo();
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
      sampahHref={sampahHref(ruang)}
      dataState={dataState}
    />
  );
}
