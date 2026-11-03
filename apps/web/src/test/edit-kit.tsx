import { render } from '@testing-library/react';
import { useState } from 'react';
import { vi } from 'vitest';
import type { AccountVM, CategoryVM, EntryVM, HistoryVM } from '@/features/ledger/types';
import { EditSheet, type EditSource } from '@/features/catat/edit-sheet';

/** Bahan tes sheet Ubah (dipakai `features/catat/edit-sheet.test.tsx` dan `conflict-notice.test.tsx`). */

export const TODAY = '2026-10-31';
export const NOW = new Date('2026-10-31T12:02:30+07:00');
export const ME = 'u-novanda';
export const FARIDA = 'u-farida';

export const ACCOUNTS: AccountVM[] = [
  {
    id: 'a-bca',
    name: 'BCA',
    pocket: 'operasional',
    walletType: 'bank',
    openedOn: '2026-10-01',
    archived: false,
    balance: 1_000_000,
  },
  {
    id: 'a-tunai',
    name: 'Tunai',
    pocket: 'operasional',
    walletType: 'cash',
    openedOn: '2026-10-01',
    archived: false,
    balance: 200_000,
  },
];

const cat = (id: string, name: string, type: 'income' | 'expense' = 'expense'): CategoryVM => ({
  id,
  parentId: null,
  name,
  type,
  icon: 'Tag',
  archived: false,
});

export const CATEGORIES: CategoryVM[] = [
  cat('c-makan', 'Makan'),
  cat('c-kopi', 'Kopi & Camilan'),
  cat('c-transport', 'Transportasi'),
  cat('c-belanja', 'Belanja'),
  cat('c-rumah', 'Rumah Tangga'),
  cat('c-hiburan', 'Hiburan'),
  cat('c-kesehatan', 'Kesehatan'),
  cat('c-gaji', 'Gaji', 'income'),
];

export const ENTRY: EntryVM = {
  id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  version: 2,
  kind: 'expense',
  occurredOn: '2026-10-30',
  createdAt: '2026-10-30T08:00:00+07:00',
  createdBy: { id: ME, name: 'Novanda', initial: 'N' },
  accountId: 'a-bca',
  accountName: 'BCA',
  amount: 50_000,
  categoryId: 'c-kesehatan',
  categoryName: 'Kesehatan',
  description: 'Vitamin',
  reimbursable: true,
};

/** Versi terbaru dari "tab lain": Farida mengubah nominal dan dompet 2 menit lalu. */
export const LATEST: EntryVM = {
  ...ENTRY,
  version: 3,
  amount: 45_000,
  accountId: 'a-tunai',
  accountName: 'Tunai',
  description: 'Vitamin C',
};

export const LATEST_HISTORY: HistoryVM[] = [
  {
    version: 1,
    op: 'create',
    at: '2026-10-30T08:00:00+07:00',
    by: { name: 'Novanda', initial: 'N' },
    changedBy: ME,
    amount: 40_000,
  },
  {
    version: 2,
    op: 'update',
    at: '2026-10-30T09:00:00+07:00',
    by: { name: 'Novanda', initial: 'N' },
    changedBy: ME,
    amount: 50_000,
  },
  {
    version: 3,
    op: 'update',
    at: '2026-10-31T12:00:00+07:00',
    by: { name: 'Farida', initial: 'F' },
    changedBy: FARIDA,
    amount: 45_000,
  },
];

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Update = EditSource['update'];
type Reload = EditSource['reload'];

export function renderEdit(
  opts: {
    entry?: EntryVM;
    update?: Update;
    reload?: Reload;
  } = {},
) {
  const update = vi.fn<Update>(
    opts.update ?? (() => Promise.resolve({ ok: true, value: { entryId: ENTRY.id, version: 3 } })),
  );
  const reload = vi.fn<Reload>(
    opts.reload ??
      (() => Promise.resolve({ ok: true, value: { entry: LATEST, history: LATEST_HISTORY } })),
  );
  const onSaved = vi.fn();
  const source: EditSource = { update, reload };
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <EditSheet
        open={open}
        onOpenChange={setOpen}
        ruang="pribadi"
        entry={opts.entry ?? ENTRY}
        accounts={ACCOUNTS}
        categories={CATEGORIES}
        today={TODAY}
        me={ME}
        source={source}
        onSaved={onSaved}
        now={() => NOW}
      />
    );
  }
  render(<Host />);
  return { update, reload, onSaved };
}
