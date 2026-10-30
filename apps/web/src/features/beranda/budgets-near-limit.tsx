'use client';

import { WarningIcon } from '@phosphor-icons/react';
import { budgetProgress } from '@dompetku/demo-data';
import type { BerandaContext } from './context';
import { BerandaSection, Row } from './section';

export function BudgetsNearLimit({ state, ruang, today }: BerandaContext) {
  const near = budgetProgress(state, ruang, today).filter((p) => p.pct >= 80);

  return (
    <BerandaSection title="Anggaran hampir habis">
      {near.length === 0 ? (
        <p className="text-base text-text-muted">Belum ada anggaran yang mendekati batas.</p>
      ) : (
        <ul>
          {near.map((p) => (
            <Row key={p.budget.categoryId}>
              <span className="min-w-0 text-base break-words text-text">{p.category.name}</span>
              <span
                className={`flex shrink-0 items-center gap-1 text-base font-medium ${p.pct >= 100 ? 'text-danger' : 'text-warning'}`}
              >
                <WarningIcon size={20} weight="fill" aria-hidden="true" />
                <span>{`${String(p.pct)}% terpakai`}</span>
              </span>
            </Row>
          ))}
        </ul>
      )}
    </BerandaSection>
  );
}
