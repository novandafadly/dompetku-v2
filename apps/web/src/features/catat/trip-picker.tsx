'use client';

import type { RefObject } from 'react';
import { AirplaneTiltIcon } from '@/components/ui/icons/airplane-tilt';
import { InfoIcon } from '@/components/ui/icons/info';
import { XIcon } from '@/components/ui/icons/x';
import { focusRing } from '@/components/ui/styles';
import { FieldErrorText } from './catat-status';

/** Salinan pemilih Trip di Catat/Ubah (S15-TR14..TR16, TR19). */
export const TRIP_PICKER_COPY = {
  add: 'Tambah ke trip',
  chipLabel: (name: string) => `Trip ${name}, ganti`,
  detach: 'Lepas',
  detachLabel: (name: string) => `Lepas dari trip ${name}`,
  chooseTitle: (ruangLabel: string) => `Pilih trip · ${ruangLabel}`,
  none: 'Tidak masuk trip',
  dateMatches: 'Sesuai tanggal',
  suggestedNote: 'Dipilih otomatis karena tanggalnya di rentang trip.',
  autoDetachedNote: 'Trip dilepas: pengeluaran Kantor atau talangan tidak bisa masuk trip.',
  splitLockedNote:
    'Trip tidak bisa diubah sesudah tagihan dibagi. Batalkan tagihan di Patungan bila salah.',
  archivedSuffix: (name: string) => `${name} · Diarsipkan`,
  archivedError: (name: string) => `Trip ${name} sudah diarsipkan. Pilih trip lain atau lepas.`,
  invalidError: 'Pengeluaran ini tidak bisa masuk trip.',
  loadingChoices: 'Memuat pilihan trip…',
} as const;

export interface SelectedTrip {
  id: string;
  name: string;
  archived?: boolean | undefined;
}

/**
 * Baris pemilih `Trip` di sheet Catat dan Ubah (S15-TR14, TR15):
 * - belum dipilih: tombol teks 44 `Tambah ke trip`;
 * - terpilih: chip 44 (`Trip {nama}, ganti`) + tombol `Lepas` 44 (`Lepas dari trip {nama}`);
 * - sub-catatan saran K9 (`sr-only` pada mode `compact`) atau catatan patungan K6;
 * - galat kolom (`trip_archived`/`trip_entry_invalid`).
 */
export function TripPickerRow({
  selected,
  suggested = false,
  splitting = false,
  compact = false,
  busy = false,
  error = null,
  errorId,
  chipRef,
  onOpenPicker,
  onClear,
}: {
  selected: SelectedTrip | null;
  suggested?: boolean;
  splitting?: boolean;
  compact?: boolean;
  busy?: boolean;
  error?: string | null;
  errorId?: string | undefined;
  chipRef?: RefObject<HTMLButtonElement | null>;
  onOpenPicker: () => void;
  onClear: () => void;
}) {
  const displayName =
    selected === null
      ? ''
      : selected.archived === true
        ? TRIP_PICKER_COPY.archivedSuffix(selected.name)
        : selected.name;

  return (
    <div className="flex flex-col gap-1">
      {selected === null ? (
        <button
          ref={chipRef}
          type="button"
          aria-disabled={busy || undefined}
          aria-describedby={error === null ? undefined : errorId}
          onClick={() => {
            if (!busy) onOpenPicker();
          }}
          className={`inline-flex min-h-11 items-center gap-2 self-start rounded-lg px-2 text-label font-semibold text-text-soft hover-pointer:bg-hover active:bg-surface-2 aria-disabled:text-text-muted ${focusRing}`}
        >
          <AirplaneTiltIcon size={18} className="shrink-0" />
          <span>{TRIP_PICKER_COPY.add}</span>
        </button>
      ) : (
        <div className="flex min-h-11 items-center gap-2">
          <button
            ref={chipRef}
            type="button"
            title={selected.name}
            aria-label={TRIP_PICKER_COPY.chipLabel(selected.name)}
            aria-disabled={busy || undefined}
            aria-describedby={error === null ? undefined : errorId}
            onClick={() => {
              if (!busy) onOpenPicker();
            }}
            className={`inline-flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-lg border ${error === null ? 'border-accent-text bg-accent-tint text-accent-text' : 'border-danger bg-danger-tint text-danger'} px-3 text-label font-semibold hover-pointer:bg-hover aria-disabled:border-hairline aria-disabled:text-text-muted ${focusRing}`}
          >
            <AirplaneTiltIcon size={16} weight="fill" className="shrink-0" />
            <span className="min-w-0 truncate">{displayName}</span>
          </button>
          <button
            type="button"
            aria-label={TRIP_PICKER_COPY.detachLabel(selected.name)}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) onClear();
            }}
            className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2.5 text-label font-semibold text-text-soft hover-pointer:bg-hover active:bg-surface-2 aria-disabled:text-text-muted ${focusRing}`}
          >
            <XIcon size={14} weight="bold" className="shrink-0" />
            <span>{TRIP_PICKER_COPY.detach}</span>
          </button>
        </div>
      )}
      {suggested && selected !== null ? (
        <p
          className={
            compact
              ? 'sr-only'
              : 'flex items-start gap-1.5 text-caption font-medium text-text-muted'
          }
        >
          <InfoIcon size={12} className="mt-0.5 shrink-0" />
          <span>{TRIP_PICKER_COPY.suggestedNote}</span>
        </p>
      ) : null}
      {splitting && selected !== null ? (
        <p className="flex items-start gap-1.5 text-caption font-medium text-text-muted">
          <InfoIcon size={12} className="mt-0.5 shrink-0" />
          <span>{TRIP_PICKER_COPY.splitLockedNote}</span>
        </p>
      ) : null}
      {error === null || errorId === undefined ? null : (
        <FieldErrorText id={errorId}>{error}</FieldErrorText>
      )}
    </div>
  );
}
