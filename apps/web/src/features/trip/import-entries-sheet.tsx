'use client';

import { shortDateLabel } from '@dompetku/domain';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/form-parts';
import { MoneyText } from '@/components/ui/money-text';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { rowDivider } from '@/components/ui/styles';
import { newClientId } from '@/features/ledger/client-id';
import type { TripCandidateVM } from '@/features/ledger/trip-types';
import type { LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { TRIP_COPY as C } from './copy';
import { tripImportFailedText } from './galat';

export type ImportResult = { ok: true; changed: number } | { ok: false; code: LedgerErrorCode };

export interface ImportEntriesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruang: Ruang;
  tripName: string;
  candidates: readonly TripCandidateVM[];
  onConfirm: (input: { clientId: string; entryIds: string[] }) => Promise<ImportResult>;
  onImported: (info: { entryIds: string[]; changed: number }) => void;
}

/**
 * Sheet pratinjau `Masukkan ke {nama trip} · {Ruang}` (S15-TR9): daftar baca-saja tanpa kotak
 * centang dan tanpa tautan; satu tombol memasukkan seluruh daftar (maks 100, atomik di DB).
 * `clientId` lahir sekali per pembukaan sheet: klik ganda/Coba lagi = replay aman.
 */
export function ImportEntriesSheet(props: ImportEntriesSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <ImportSession key={session} {...props} />;
}

function ImportSession({
  open,
  onOpenChange,
  ruang,
  tripName,
  candidates,
  onConfirm,
  onImported,
}: ImportEntriesSheetProps) {
  const [clientId] = useState(newClientId);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<LedgerErrorCode | null>(null);
  const busy = useRef(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  async function submit() {
    if (busy.current || candidates.length === 0) return;
    busy.current = true;
    setSaving(true);
    setFailure(null);
    const entryIds = candidates.map((c) => c.entryId);
    let res: ImportResult;
    try {
      res = await onConfirm({ clientId, entryIds });
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (res.ok) {
      onImported({ entryIds, changed: res.changed });
      return;
    }
    setFailure(res.code);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
      title={C.importSheetTitle(tripName, ruang)}
      titleContent={
        <>
          <span className="min-w-0 break-words">{C.importSheetHeading(tripName)}</span>
          <SpaceTag space={ruang} />
        </>
      }
      tint={ruang}
      initialFocus={confirmRef}
      fill
      footer={
        <div className="flex flex-col gap-2 tablet:flex-row-reverse">
          <Button
            ref={confirmRef}
            className="flex-1"
            aria-disabled={saving || candidates.length === 0 || undefined}
            aria-busy={saving || undefined}
            onClick={() => {
              void submit();
            }}
          >
            {saving ? C.importing : C.importButton(candidates.length)}
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            aria-disabled={saving || undefined}
            onClick={() => {
              if (!saving) onOpenChange(false);
            }}
          >
            {C.cancel}
          </Button>
        </div>
      }
    >
      <p className="text-meta font-medium text-text-soft">{C.importSheetNote}</p>
      {failure === null ? null : <Alert>{tripImportFailedText(failure)}</Alert>}
      <ul className="flex flex-col">
        {candidates.map((item) => {
          const title = item.description ?? item.categoryName ?? C.uncategorized;
          return (
            <li
              key={item.entryId}
              className={`${rowDivider} flex items-start justify-between gap-3 py-2.5 max-narrow:flex-col max-narrow:gap-1`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  title={title}
                  className="line-clamp-2 text-body/tight font-semibold break-words text-text"
                >
                  {title}
                </span>
                <span className="text-meta font-medium text-text-muted">
                  {`${shortDateLabel(item.occurredOn)} · ${item.accountName}`}
                </span>
              </div>
              <MoneyText
                value={-item.amount}
                kind="expense"
                size="inherit"
                className="shrink-0 text-body font-bold"
              />
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
