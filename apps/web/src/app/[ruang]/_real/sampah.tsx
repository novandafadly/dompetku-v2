import type { IsoDate } from '@dompetku/domain';
import type { Route } from 'next';
import type { Ruang } from '@/features/ledger/types';
import { TrashFailed } from '@/features/sampah/trash-states';
import type { SampahData } from '@/server/ledger/sampah';
import { TRASH_WIDTH, TrashHeader } from '../sampah/trash-parts';
import { TrashListIsland } from './sampah-islands';
import { RetryIsland } from './transaksi-islands';

/**
 * Sampah mode nyata (Server Component): header dan keadaan dirender di server dari data ruang ini
 * saja; daftar + `Pulihkan` adalah pulau klien yang dimuat malas.
 */
export function SampahReal({
  ruang,
  today,
  backHref,
  data,
  me,
}: {
  ruang: Ruang;
  today: IsoDate;
  backHref: Route;
  data: SampahData;
  /** User sesi: hanya untuk menghitung `restoreLockedIds` di server, tidak dikirim ke klien. */
  me: string;
}) {
  // Kaki antar ruang hanya dipulihkan pencatatnya (R25; server menjawab not_found untuk yang lain).
  const locked = data.items
    .filter((t) => t.entry.kind === 'space_transfer' && t.entry.createdBy.id !== me)
    .map((t) => t.entry.id);
  return (
    <section className={TRASH_WIDTH}>
      <TrashHeader ruang={ruang} backHref={backHref} />
      <TrashListIsland
        ruang={ruang}
        today={today}
        items={data.items}
        accounts={data.accounts}
        {...(locked.length > 0 ? { restoreLockedIds: locked } : {})}
      />
    </section>
  );
}

/** Gagal muat (galat loader ditangkap page): salinan tetap S6-S1 + Coba lagi (`router.refresh`). */
export function SampahFailed({ ruang, backHref }: { ruang: Ruang; backHref: Route }) {
  return (
    <section className={TRASH_WIDTH}>
      <TrashHeader ruang={ruang} backHref={backHref} />
      <TrashFailed actions={<RetryIsland />} />
    </section>
  );
}
