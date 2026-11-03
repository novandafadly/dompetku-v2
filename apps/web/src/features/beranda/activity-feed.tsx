'use client';

import { activityFeed } from '@dompetku/demo-data';
import { dayLabel, timeLabelWIB } from '@dompetku/domain';
import { UsersThreeIcon } from '@/components/ui/icons/users-three';
import { EmptyLine, ListCard } from '@/components/ui/list-card';
import { ActivityRow } from '@/components/ui/activity-row';
import type { BerandaContext } from './context';

export function ActivityFeed({ state, today }: BerandaContext) {
  const feed = activityFeed(state, 5);

  return (
    <ListCard title="Aktivitas" icon={<UsersThreeIcon size={18} />}>
      {feed.length === 0 ? (
        <EmptyLine>
          Belum ada aktivitas. Yang kamu dan Farida catat di Bersama akan muncul di sini, terbaru di
          atas.
        </EmptyLine>
      ) : (
        <ul>
          {feed.map((a) => (
            <ActivityRow
              key={a.id}
              initial={a.actor.initial}
              name={a.actor.name}
              text={a.text}
              time={`${dayLabel(a.at.slice(0, 10), today)} · ${timeLabelWIB(a.at)}`}
              amount={a.amount}
            />
          ))}
        </ul>
      )}
    </ListCard>
  );
}
