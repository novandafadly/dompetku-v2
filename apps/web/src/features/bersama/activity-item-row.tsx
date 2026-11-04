import { dayLabel, formatRupiah, timeLabelWIB, type IsoDate, type Rupiah } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import { MoneyText } from '@/components/ui/money-text';
import { focusRing, rowDivider } from '@/components/ui/styles';
import type { ActivityItemVM } from './types';

/**
 * Baris feed Aktivitas Bersama (S8-A1/A3). Server Component tanpa JS klien (budget S8): hanya
 * props tampilan, tanpa id entri atau id anggota (hanya `href` bila baris menaut). Komponen
 * prototipe `ActivityRow` sengaja tidak disentuh (headroom budget Beranda prototipe).
 */

/** Waktu baris: `Hari ini · 10.32`; `today = null` (halaman Aktivitas) = `10.32`; plus tanggal mundur. */
export function activityTimeLabel(
  at: string,
  today: IsoDate | null,
  backdate: string | null,
): string {
  const time = timeLabelWIB(at);
  const head = today === null ? time : `${dayLabel(at.slice(0, 10), today)} · ${time}`;
  return backdate === null ? head : `${head} · ${backdate}`;
}

const grid =
  'max-narrow:grid max-narrow:grid-cols-tile-text max-narrow:items-center max-narrow:gap-y-0.75';

export interface ActivityRowProps {
  actor: Pick<ActivityItemVM['actor'], 'name' | 'initial' | 'role'>;
  text: string;
  change: string[];
  srText?: string | undefined;
  /** Sudah jadi (lihat `activityTimeLabel`). */
  time: string;
  amount: Rupiah | null;
  /** `null` = baris tanpa target: tetap `li`, bukan tautan. */
  href: Route | null;
}

export function ActivityItemRow({
  actor,
  text,
  change,
  srText,
  time,
  amount,
  href,
}: ActivityRowProps) {
  // Nominal sangat panjang (> 13 karakter) di bawah 360 px turun ke baris kedua kolom teks
  // (pola TxRow) agar kalimat tidak terperas jadi "menyetor ke…".
  const long = amount !== null && formatRupiah(amount).length > 13;
  const body = (
    <>
      <span
        data-initial=""
        aria-hidden="true"
        className={`flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-label font-extrabold ${long ? 'max-narrow:row-span-2' : ''} ${
          actor.role === 'member' ? 'bg-bersama-tint text-bersama' : 'bg-surface-3 text-text'
        }`}
      >
        {actor.initial}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-4 text-label font-medium break-words text-text">
          <span className="font-bold">{actor.name}</span> · {text}
        </span>
        {change.length > 0 ? (
          <>
            <span aria-hidden="true" className="flex flex-col text-meta font-medium text-text-soft">
              {change.slice(0, 2).map((c) => (
                <span key={c} className="num break-words">
                  {c}
                </span>
              ))}
            </span>
            {srText === undefined ? null : <span className="sr-only">{srText}</span>}
          </>
        ) : null}
        <span className="text-caption font-medium text-text-muted">{time}</span>
      </span>
      {/* Spasi di DOM agar teks baris terbaca utuh oleh pembaca layar. */}{' '}
      {amount === null ? null : (
        <span className={long ? 'max-narrow:col-start-2 max-narrow:justify-self-start' : ''}>
          <MoneyText value={amount} />
        </span>
      )}
    </>
  );
  return (
    <li className={rowDivider}>
      {href === null ? (
        <div className={`flex min-h-15.5 items-center gap-3 py-2.5 ${long ? grid : ''}`}>
          {body}
        </div>
      ) : (
        <Link
          href={href}
          className={`-mx-4 flex min-h-15.5 items-center gap-3 px-4 py-2.5 hover-pointer:bg-hover active:bg-hover ${focusRing} ${long ? grid : ''}`}
        >
          {body}
        </Link>
      )}
    </li>
  );
}
