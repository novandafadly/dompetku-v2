import type { IsoDate } from '@dompetku/domain';
import type { Route } from 'next';
import { UsersThreeIcon } from '@/components/ui/icons/users-three';
import { EmptyLine, ListCard } from '@/components/ui/list-card';
import { ActivityItemRow, activityTimeLabel } from './activity-item-row';
import { CardError } from './card-error';
import type { ActivityItemVM } from './types';

/**
 * Kartu Aktivitas Beranda Bersama dua anggota (S8-A1). Server Component tanpa JS klien dan tanpa
 * modul demo; hanya props tampilan. `listHref` = tautan `Semua` (`null` = tidak ada baris);
 * `emptyNames` = nama anggota lain untuk salinan kosong.
 */
export function ActivityCardView({
  items,
  listHref,
  emptyNames,
  today,
  query = '',
}: {
  items: ActivityItemVM[];
  listHref: Route | null;
  emptyNames: string | null;
  today: IsoDate;
  /** Query yang dibawa tautan (mode nyata: `theme`), '' atau '?a=b'; ikut ke tautan baris. */
  query?: string;
}) {
  return (
    <ListCard
      title="Aktivitas"
      icon={<UsersThreeIcon size={18} />}
      {...(listHref === null
        ? {}
        : { link: { href: listHref, label: 'Semua', srLabel: 'aktivitas Bersama' } })}
    >
      {items.length === 0 ? (
        <EmptyLine>
          {emptyNames === null
            ? 'Belum ada aktivitas. Yang dicatat di Bersama akan muncul di sini, terbaru di atas.'
            : `Belum ada aktivitas. Yang kamu dan ${emptyNames} catat di Bersama akan muncul di sini, terbaru di atas.`}
        </EmptyLine>
      ) : (
        <ul>
          {items.map((a) => (
            <ActivityItemRow
              key={a.key}
              actor={a.actor}
              text={a.text}
              change={a.change}
              srText={a.srText}
              time={activityTimeLabel(a.at, today, a.backdate)}
              amount={a.amount}
              href={a.href === null ? null : (`${a.href}${query}` as Route)}
            />
          ))}
        </ul>
      )}
    </ListCard>
  );
}

/** Kartu Aktivitas yang bacaannya gagal (savepoint Task 4): kartu lain di Beranda tetap tampil. */
export function ActivityCardError({ retryHref }: { retryHref: string }) {
  return (
    <ListCard title="Aktivitas" icon={<UsersThreeIcon size={18} />}>
      <CardError message="Aktivitas belum bisa dimuat." retryHref={retryHref} />
    </ListCard>
  );
}
