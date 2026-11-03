'use client';

import { useId, type ReactNode, type Ref, type RefObject } from 'react';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { ArrowsLeftRightIcon } from '@/components/ui/icons/arrows-left-right';
import { CaretDownIcon } from '@/components/ui/icons/caret-down';
import { InfoIcon } from '@/components/ui/icons/info';

/**
 * Select di baris meta Catat (Dompet, Tanggal): 44 px, ikon + nilai + caret. Select bawaan dipakai
 * agar papan ketik dan pembaca layar bekerja seperti biasa; labelnya untuk pembaca layar (ikon sudah menandai).
 */
export function MetaSelect({
  label,
  icon,
  value,
  onChange,
  options,
  dataDate,
  invalid = false,
  describedBy,
  selectRef,
  busy = false,
  tight = false,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  dataDate?: string;
  /** Galat kolom (S6-C5): border 2 px `danger` + `aria-invalid`. */
  invalid?: boolean;
  describedBy?: string | undefined;
  selectRef?: Ref<HTMLSelectElement>;
  /** Selama menyimpan: `aria-disabled`, perubahan diabaikan, fokus tetap. */
  busy?: boolean;
  /**
   * HP dengan tombol Talangan di baris yang sama (S7-C2): jarak dalam dirapatkan agar `Hari ini`
   * tidak terpotong di 360 px (dua kolom ±108 px).
   */
  tight?: boolean;
}) {
  const id = useId();
  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 flex items-center text-text-soft ${tight ? 'left-3 max-tablet:left-2.5' : 'left-3'}`}
      >
        {icon}
      </span>
      <select
        id={id}
        ref={selectRef}
        data-date={dataDate}
        aria-invalid={invalid || undefined}
        aria-disabled={busy || undefined}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => {
          if (!busy) onChange(e.target.value);
        }}
        className={`h-11 w-full min-w-0 appearance-none truncate rounded-lg border border-border bg-transparent text-label font-semibold text-text hover-pointer:bg-hover aria-invalid:border-2 aria-invalid:border-danger aria-disabled:border-hairline aria-disabled:text-text-muted ${tight ? 'pr-8 pl-9.5 max-tablet:pr-6.5 max-tablet:pl-8.5' : 'pr-8 pl-9.5'}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-surface text-text">
            {o.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 flex items-center text-text-muted ${tight ? 'right-3 max-tablet:right-2' : 'right-3'}`}
      >
        <CaretDownIcon size={14} weight="bold" />
      </span>
    </div>
  );
}

const noop = () => undefined;

/** Salinan tetap S7-C1. */
export const CROSS_COPY = {
  more: 'Ruang lain…',
  moreLabel: 'Pilih dompet di ruang lain',
  kantor: 'Dompet Kantor tidak bisa ikut transfer antar ruang.',
  keterangan: 'Keterangan (hanya di Pribadi)',
  catatan: 'Catatan untuk Bersama',
  audienceUmum: 'Terlihat oleh anggota Bersama',
  audience: (nama: string) => `Terlihat oleh ${nama} di Bersama`,
} as const;

/**
 * Dompet tujuan transfer: chip satu ruang (dompet sumber tidak ditawarkan) dan, bila `cross`
 * diberikan, chip `Ruang lain…` untuk dompet di ruang lain (S7-C1). Dompet ruang lain yang sudah
 * dipilih tampil sebagai chip terpilih `{Dompet} · {Ruang tujuan}` (satu baris, ellipsis, `title`
 * penuh); chip satu ruang lalu tidak terpilih.
 */
export function DestinationChips({
  accounts,
  value,
  onChange,
  busy = false,
  crossEnabled = false,
  crossLabel,
  crossBlocked = false,
  onOpenCross,
  crossMoreRef,
  crossSelectedRef,
}: {
  accounts: { id: string; name: string }[];
  value: string | undefined;
  onChange: (accountId: string) => void;
  busy?: boolean;
  /** Transfer antar ruang tersedia (S7-C1): chip `Ruang lain…` dan keterangan Kantor. */
  crossEnabled?: boolean;
  /** Teks chip terpilih di ruang lain; tidak ada = belum memilih. */
  crossLabel?: string | undefined;
  /** Sumber Kantor: `Ruang lain…` tidak dirender, diganti keterangan. */
  crossBlocked?: boolean;
  onOpenCross?: () => void;
  crossMoreRef?: RefObject<HTMLButtonElement | null>;
  crossSelectedRef?: RefObject<HTMLButtonElement | null>;
}) {
  const crossSelected = crossLabel !== undefined;
  const first = value === undefined || crossSelected ? 0 : -1;
  return (
    <>
      <ChipGroup label="Ke dompet">
        {accounts.map((a, i) => (
          <Chip
            key={a.id}
            variant="category"
            selected={!crossSelected && a.id === value}
            ariaDisabled={busy}
            focusable={!crossSelected && first === i}
            onSelect={() => {
              onChange(a.id);
            }}
          >
            {a.name}
          </Chip>
        ))}
        {crossLabel === undefined ? null : (
          <Chip
            variant="category"
            selected
            ariaDisabled={busy}
            // Mengganti lewat `Ruang lain…`; panah di grup tidak boleh membuka halaman.
            onSelect={noop}
            {...(crossSelectedRef === undefined ? {} : { buttonRef: crossSelectedRef })}
          >
            <span className="max-w-52 truncate" title={crossLabel}>
              {crossLabel}
            </span>
          </Chip>
        )}
        {!crossEnabled || crossBlocked ? null : (
          <button
            ref={crossMoreRef}
            type="button"
            aria-label={CROSS_COPY.moreLabel}
            aria-disabled={busy || undefined}
            onClick={busy ? undefined : onOpenCross}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3.5 text-label font-semibold whitespace-nowrap text-text hover-pointer:bg-hover focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus active:bg-surface-2 aria-disabled:border-hairline aria-disabled:text-text-muted"
          >
            <ArrowsLeftRightIcon size={16} className="shrink-0 text-text-soft" />
            {CROSS_COPY.more}
          </button>
        )}
      </ChipGroup>
      {crossEnabled && crossBlocked ? (
        <p className="flex items-center gap-1.5 text-meta font-semibold text-text-soft">
          <InfoIcon size={14} className="shrink-0" />
          {CROSS_COPY.kantor}
        </p>
      ) : null}
    </>
  );
}
