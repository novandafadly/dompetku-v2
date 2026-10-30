'use client';

import { activityFeed } from '@dompetku/demo-data';
import { dayLabel, timeLabelWIB } from '@dompetku/domain';
import { MoneyText } from '@/components/ui/money-text';
import { listRow } from '@/components/ui/styles';
import type { BerandaContext } from './context';
import { BerandaSection, EmptyLine } from './section';

export function ActivityFeed({ state, today }: BerandaContext) {
  const feed = activityFeed(state, 5);

  return (
    <BerandaSection title="Aktivitas">
      {feed.length === 0 ? (
        <EmptyLine>
          Belum ada aktivitas. Yang kamu dan Farida catat di Bersama akan muncul di sini, terbaru di
          atas.
        </EmptyLine>
      ) : (
        <ul>
          {feed.map((a) => (
            <li key={a.id} className={`flex min-h-12 items-center gap-3 py-2 ${listRow}`}>
              <span
                data-initial=""
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-surface-2 text-sm font-semibold text-text"
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
