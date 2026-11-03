'use client';

import type { IsoDate } from '@dompetku/domain';
import { useRouter } from 'next/navigation';
import type { AccountVM, Ruang, TrashVM } from '@/features/ledger/types';
import { restoreEntryAction } from '../_actions/entri';
import { TrashList } from '../sampah/trash-parts';

/**
 * Daftar Sampah nyata (pulau klien, dimuat malas lewat `sampah-islands`): `Pulihkan` =
 * `restoreEntryAction` (Server Action; sesudah berhasil `refresh()` memuat ulang daftar), konflik
 * versi memuat ulang daftar lewat `router.refresh()`.
 */
export function TrashListReal({
  ruang,
  today,
  items,
  accounts,
}: {
  ruang: Ruang;
  today: IsoDate;
  items: TrashVM[];
  accounts: AccountVM[];
}) {
  const router = useRouter();
  return (
    <TrashList
      ruang={ruang}
      today={today}
      items={items}
      accounts={accounts}
      restore={(req) => restoreEntryAction(ruang, req)}
      onConflict={() => {
        router.refresh();
      }}
    />
  );
}
