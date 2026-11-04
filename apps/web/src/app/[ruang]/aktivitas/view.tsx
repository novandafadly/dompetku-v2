'use client';

import { activityFeed } from '@dompetku/demo-data';
import { dayLabel, timeLabelWIB } from '@dompetku/domain';
import { useMemo } from 'react';
import { ActivityRow } from '@/components/ui/activity-row';
import { BackLink } from '@/components/ui/back-link';
import { UsersThreeIcon } from '@/components/ui/icons/users-three';
import { EmptyState } from '@/components/ui/state';
import { card } from '@/components/ui/styles';
import { useDemo } from '@/features/shell/demo-context';
import { PageHeader } from '@/features/shell/page-header';

/**
 * Aktivitas prototipe (K5 "ringan"): feed demo `activityFeed(state, 100)` per hari, tanpa
 * paginasi dan tanpa tautan baris. Rute sendiri: tidak menambah apa pun ke Beranda prototipe.
 */
export function AktivitasPage() {
  const { state, today, href } = useDemo();
  const days = useMemo(() => {
    const out: { date: string; items: ReturnType<typeof activityFeed> }[] = [];
    for (const a of activityFeed(state, 100)) {
      const date = a.at.slice(0, 10);
      const last = out[out.length - 1];
      if (last?.date === date) last.items.push(a);
      else out.push({ date, items: [a] });
    }
    return out;
  }, [state]);
  return (
    <>
      <div className="flex flex-col">
        <BackLink href={href('bersama', 'beranda')}>Beranda</BackLink>
        <PageHeader title="Aktivitas" />
      </div>
      <div className="flex flex-col gap-3 tablet:gap-4 laptop:max-w-180">
        {days.length === 0 ? (
          <EmptyState
            icon={<UsersThreeIcon size={26} />}
            title="Belum ada aktivitas."
            description="Yang kamu dan Farida catat di Bersama akan muncul di sini, terbaru di atas."
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
                    <ActivityRow
                      key={a.id}
                      initial={a.actor.initial}
                      name={a.actor.name}
                      text={a.text}
                      time={timeLabelWIB(a.at)}
                      amount={a.amount}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </>
  );
}
