import type { IsoDate } from '@dompetku/domain';
import { dayLabel } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import { BackLink } from '@/components/ui/back-link';
import { buttonClass } from '@/components/ui/button';
import { UsersThreeIcon } from '@/components/ui/icons/users-three';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { card } from '@/components/ui/styles';
import { ActivityItemRow, activityTimeLabel } from '@/features/bersama/activity-item-row';
import type { ActivityItemVM } from '@/features/bersama/types';
import { PageHeader } from '@/features/shell/page-header';

/**
 * Halaman Aktivitas Bersama (S8-A3, K5), mode nyata. Server Component tanpa `'use client'`
 * sendiri dan tanpa pulau klien: paginasi `Muat sebelumnya` dan `Coba lagi` adalah tautan biasa.
 * Hanya props tampilan (tanpa id entri atau anggota selain di `href` baris).
 */

/** Isi maks 720 di tablet (dari shell) dan `laptop:max-w-180`; header mengikuti lebar area isi. */
const BODY = 'flex flex-col gap-3 tablet:gap-4 laptop:max-w-180';

interface Day {
  /** Tanggal WIB peristiwa (bukan `occurred_on`). */
  date: IsoDate;
  items: ActivityItemVM[];
}

/** Kelompok per hari WIB peristiwa, urutan masukan dipertahankan (sudah terbaru di atas). */
function groupByEventDay(items: readonly ActivityItemVM[]): Day[] {
  const days: Day[] = [];
  for (const it of items) {
    const date = it.at.slice(0, 10);
    const last = days[days.length - 1];
    if (last?.date === date) last.items.push(it);
    else days.push({ date, items: [it] });
  }
  return days;
}

export function AktivitasReal({
  items,
  partnerName,
  today,
  query,
  backHref,
  newestHref,
  olderHref,
}: {
  items: ActivityItemVM[];
  /** Anggota lain untuk salinan kosong; `null` = Bersama solo. */
  partnerName: string | null;
  today: IsoDate;
  /** Query yang dibawa tautan baris (mode nyata: `theme`), '' atau '?a=b'. */
  query: string;
  backHref: Route;
  /** Halaman berkursor: tautan ke daftar terbaru; `null` = sudah di halaman pertama. */
  newestHref: Route | null;
  /** Ada baris lebih lama; tanpa baris di halaman ini tautan tidak dirender (tanpa tautan mati). */
  olderHref: Route | null;
}) {
  const days = groupByEventDay(items);
  return (
    <>
      <div className="flex flex-col">
        <BackLink href={backHref}>Beranda</BackLink>
        <PageHeader title="Aktivitas" />
      </div>
      <div className={BODY}>
        {newestHref === null ? null : <BackLink href={newestHref}>Kembali ke terbaru</BackLink>}
        {days.length === 0 ? (
          <EmptyState
            icon={<UsersThreeIcon size={26} />}
            title="Belum ada aktivitas."
            description={
              partnerName === null
                ? 'Yang dicatat di Bersama akan muncul di sini, terbaru di atas.'
                : `Yang kamu dan ${partnerName} catat di Bersama akan muncul di sini, terbaru di atas.`
            }
          />
        ) : (
          <>
            <h2 className="sr-only">Daftar aktivitas</h2>
            {days.map((d) => (
              <section
                key={d.date}
                aria-labelledby={`aktivitas-${d.date}`}
                className="flex flex-col gap-2"
              >
                <h3 id={`aktivitas-${d.date}`} className="px-1 text-meta font-bold text-text-soft">
                  {dayLabel(d.date, today)}
                </h3>
                <ul className={`px-4 ${card}`}>
                  {d.items.map((a) => (
                    <ActivityItemRow
                      key={a.key}
                      actor={a.actor}
                      text={a.text}
                      change={a.change}
                      srText={a.srText}
                      time={activityTimeLabel(a.at, null, a.backdate)}
                      amount={a.amount}
                      href={a.href === null ? null : (`${a.href}${query}` as Route)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
        {olderHref === null || days.length === 0 ? null : (
          <Link
            href={olderHref}
            prefetch={false}
            className={buttonClass('secondary', 'md', 'self-start')}
          >
            Muat sebelumnya
          </Link>
        )}
      </div>
    </>
  );
}

/** Galat loader (ditangkap page): `Coba lagi` = tautan muat ulang penuh ke URL yang sama. */
export function AktivitasFailed({ backHref, retryHref }: { backHref: Route; retryHref: string }) {
  return (
    <>
      <div className="flex flex-col">
        <BackLink href={backHref}>Beranda</BackLink>
        <PageHeader title="Aktivitas" />
      </div>
      <div className={BODY}>
        <ErrorState
          title="Aktivitas belum bisa dimuat."
          description="Periksa koneksi lalu coba lagi."
          actions={
            <a href={retryHref} className={buttonClass('primary', 'md')}>
              Coba lagi
            </a>
          }
        />
      </div>
    </>
  );
}
