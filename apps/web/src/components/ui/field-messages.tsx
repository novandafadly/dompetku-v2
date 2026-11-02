import type { ReactNode } from 'react';
import { WarningCircleIcon } from './icons/warning-circle';
import { WarningIcon } from './icons/warning';

// Terpisah dari field.tsx: Nominal di placeholder Catat (muat awal) hanya butuh label dan kotak,
// jadi petunjuk/galat beserta ikonnya tidak ikut JS muat awal (ADR 0002).

export function FieldHint({
  id,
  tone = 'muted',
  children,
}: {
  id: string;
  tone?: 'muted' | 'warning';
  children: ReactNode;
}) {
  return tone === 'warning' ? (
    <p
      id={id}
      className="flex items-start gap-2 rounded-lg bg-warning-tint px-3.5 py-3 text-label font-bold text-warning"
    >
      <WarningIcon size={18} weight="fill" className="shrink-0" />
      {children}
    </p>
  ) : (
    <p id={id} className="text-caption font-medium text-text-muted">
      {children}
    </p>
  );
}

/** Galat inline: ikon + teks (tidak hanya warna), dirujuk aria-describedby. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-meta font-semibold text-danger">
      <WarningCircleIcon size={16} weight="fill" className="mt-px shrink-0" />
      {children}
    </p>
  );
}
