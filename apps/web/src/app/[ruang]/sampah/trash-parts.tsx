'use client';

import type { IsoDate } from '@dompetku/domain';
import type { Route } from 'next';
import { BackLink } from '@/components/ui/back-link';
import type { AccountVM, Ruang, TrashVM } from '@/features/ledger/types';
import { TrashListView } from '@/features/sampah/trash-list-view';
import { SAMPAH_TITLE_ID } from '@/features/sampah/trash-states';
import { RUANG_LABEL } from '@/features/shell/hrefs';
import { RestoreControl, type RestoreFn } from '../restore-control';

/** Lebar isi (S6-S1): tablet maks 720 (dari shell), laptop maks 1000, satu kolom. */
export const TRASH_WIDTH = 'flex flex-col gap-3 tablet:gap-4 laptop:max-w-250 laptop:pt-6';

/** Kembali `‹ Transaksi` + H1 `Sampah · {Ruang}`; dipakai kedua mode dan semua keadaan. */
export function TrashHeader({ ruang, backHref }: { ruang: Ruang; backHref: Route }) {
  return (
    <>
      <BackLink href={backHref}>Transaksi</BackLink>
      <h1
        id={SAMPAH_TITLE_ID}
        className="text-headline font-extrabold text-text outline-none laptop:text-title-lg"
      >
        {`Sampah · ${RUANG_LABEL[ruang]}`}
      </h1>
    </>
  );
}

/**
 * Daftar Sampah dengan alur Pulihkan bersama Detail (`RestoreControl`): kedua mode memakai ini,
 * yang berbeda hanya `restore` (nyata: Server Action; prototipe: store demo).
 */
export function TrashList({
  ruang,
  today,
  items,
  accounts,
  restore,
  onConflict,
}: {
  ruang: Ruang;
  today: IsoDate;
  items: TrashVM[];
  /** Dompet ruang ini: untuk peringatan saldo saat memulihkan; kosong = tanpa peringatan. */
  accounts: AccountVM[];
  restore: RestoreFn;
  /** Konflik versi: pemanggil memuat ulang daftar. */
  onConflict?: () => void;
}) {
  return (
    <TrashListView
      today={today}
      items={items}
      restore={({ entry }, slot) => (
        <RestoreControl
          ruang={ruang}
          entry={entry}
          account={accounts.find((a) => a.id === entry.accountId)}
          restore={restore}
          labelSuffix={slot.labelSuffix}
          onRestored={slot.onRestored}
          onConflict={onConflict}
        />
      )}
    />
  );
}
