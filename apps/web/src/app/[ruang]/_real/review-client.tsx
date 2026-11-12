'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field-messages';
import { InfoIcon } from '@/components/ui/icons/info';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { toast } from '@/components/ui/toast';
import type { Ruang } from '@/features/ledger/types';
import { RENCANA_COPY } from '@/features/rencana/copy';
import { ADJUST_ITEMS, parseAdjust, REVIEW_COPY } from './review-copy';
import { copyBudgetsAction } from '../_actions/rencana';

/**
 * Kartu `Siapkan {Bulan}` (S10-RV2): salin anggaran periode yang dilihat ke periode berikutnya
 * dengan penyesuaian persen (pilihan cepat atau `Lain…`). Uang dihitung di SQL (`copy_budgets`);
 * di sini hanya bilangan bulat persen. Idempoten: "Coba lagi" tidak menyalin dua kali.
 */
export function ReviewCopyCard({
  ruang,
  toMonth,
  fromTitle,
  toTitle,
  count,
}: {
  ruang: Ruang;
  /** `YYYY-MM` periode tujuan (label). */
  toMonth: string;
  fromTitle: string;
  toTitle: string;
  count: number;
}) {
  const [pick, setPick] = useState('0');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();
  const fieldId = useId();
  const errorId = useId();
  const pct = pick === 'other' ? parseAdjust(custom) : Number(pick);
  const invalid = pick === 'other' && pct === null;

  async function copy() {
    if (busy) return;
    if (pct === null) {
      setError(REVIEW_COPY.errPct);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await copyBudgetsAction(ruang, { toMonth, adjustPct: pct });
      if (!res.ok) {
        setError(
          res.error.code === 'network' ? RENCANA_COPY.errCopyNetwork : RENCANA_COPY.errCopyServer,
        );
        return;
      }
      const v = res.value;
      const skipped = v.skippedExisting + v.skippedConflict + v.skippedArchived + v.skippedParent;
      toast({
        message:
          v.copied > 0
            ? REVIEW_COPY.copied(v.copied, toTitle, ruang, skipped, pct)
            : REVIEW_COPY.allExist(toTitle),
      });
    } catch {
      setError(RENCANA_COPY.errCopyNetwork);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface p-4"
    >
      <h2 id={headingId} className="text-body font-bold text-text">
        {REVIEW_COPY.prepare(toTitle)}
      </h2>
      <p className="flex items-start gap-2 text-label font-medium text-text-soft">
        <InfoIcon size={18} className="mt-px shrink-0" />
        <span className="text-pretty">{REVIEW_COPY.prepareBody(fromTitle, toTitle)}</span>
      </p>
      <div className="flex flex-col gap-1.5">
        <span id={`${headingId}-adj`} className="text-label font-semibold text-text-soft">
          {REVIEW_COPY.adjust}
        </span>
        <SegmentedControl
          items={[...ADJUST_ITEMS]}
          value={pick}
          onChange={(v) => {
            setPick(v);
            setError(null);
          }}
          labelledBy={`${headingId}-adj`}
        />
      </div>
      {pick === 'other' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fieldId} className="text-label font-semibold text-text-soft">
            {REVIEW_COPY.adjustField}
          </label>
          <input
            id={fieldId}
            inputMode="numeric"
            autoComplete="off"
            value={custom}
            aria-invalid={invalid && custom !== '' ? true : undefined}
            aria-describedby={invalid && custom !== '' ? errorId : undefined}
            onChange={(e) => {
              setCustom(e.target.value);
              setError(null);
            }}
            className="h-12 w-full min-w-0 rounded-lg border border-border bg-bg px-3.5 text-body font-medium text-text aria-invalid:border-2 aria-invalid:border-danger"
          />
          {invalid && custom !== '' ? (
            <div role="alert">
              <FieldError id={errorId}>{REVIEW_COPY.errPct}</FieldError>
            </div>
          ) : null}
        </div>
      ) : null}
      {pct !== null && pct !== 0 ? (
        <p className="text-meta font-medium text-text-muted">{REVIEW_COPY.rounded}</p>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-label font-semibold text-danger">
          {error}
        </p>
      )}
      <Button
        aria-disabled={busy || invalid || undefined}
        aria-busy={busy || undefined}
        onClick={() => {
          void copy();
        }}
        className="w-full"
      >
        {busy ? REVIEW_COPY.copying : REVIEW_COPY.copyN(count)}
      </Button>
    </section>
  );
}
