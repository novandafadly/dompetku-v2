'use client';

import { useMemo } from 'react';
import { TrashLoading } from '@/features/sampah/trash-states';
import { useDemo } from '@/features/shell/demo-context';
import { trashItems } from './demo-items';
import { TRASH_WIDTH, TrashHeader, TrashList } from './trash-parts';

/**
 * Isi Sampah prototipe (dimuat malas oleh `view.tsx`): entri batal dari store demo, `Pulihkan` =
 * `store.restoreEntry`. Tanpa jaringan, jadi tanpa saldo/konflik/lewat-90-hari (daftar sudah disaring).
 */
export default function SampahDemoBody() {
  const { state, store, ruang, today, href, dataState } = useDemo();
  const items = useMemo(() => trashItems(state, ruang, today), [state, ruang, today]);
  return (
    <section className={TRASH_WIDTH}>
      <TrashHeader ruang={ruang} backHref={href(ruang, 'transaksi')} />
      {dataState === 'loading' ? (
        <TrashLoading />
      ) : (
        <TrashList
          ruang={ruang}
          today={today}
          items={items}
          accounts={[]}
          restore={({ entryId }) => {
            store.restoreEntry(entryId);
            return Promise.resolve({ ok: true, value: { version: 1 } });
          }}
        />
      )}
    </section>
  );
}
