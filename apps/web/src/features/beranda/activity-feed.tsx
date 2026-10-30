'use client';

import { activityFeed } from '@dompetku/demo-data';
import { dayLabel, timeLabelWIB } from '@dompetku/domain';
import { MoneyText } from '@/components/ui/money-text';
import type { BerandaContext } from './context';
import { BerandaSection } from './section';

export function ActivityFeed({ state, today }: BerandaContext) {
  const feed = activityFeed(state, 5);

  return (
    <BerandaSection title="Aktivitas">
      {feed.length === 0 ? (
        <p className="text-base text-text-muted">
          Belum ada aktivitas. Yang kamu dan Farida catat di Bersama akan muncul di sini, terbaru di
          atas.
        </p>
      ) : (
        <ul>
          {feed.map((a) => (
            <li key={a.id} className="flex min-h-11 items-center gap-3 py-1.5">
              <span
                data-initial=""
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-accent-tint text-sm font-semibold text-accent"
              >
                {a.actor.initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base break-words text-text">
                  <span className="font-semibold">{a.actor.name}</span> {a.text}
                </p>
                <p className="text-sm text-text-muted">
                  {dayLabel(a.at.slice(0, 10), today)} {timeLabelWIB(a.at)}
                </p>
              </div>
              {a.amount !== undefined ? <MoneyText value={a.amount} /> : null}
            </li>
          ))}
        </ul>
      )}
    </BerandaSection>
  );
}
