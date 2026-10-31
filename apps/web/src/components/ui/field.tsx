import type { ReactNode } from 'react';
import { WarningCircleIcon } from './icons/warning-circle';
import { WarningIcon } from './icons/warning';

/** Label field 13/600 text-soft di atas kontrol; "(opsional)" lebih redup. */
export function FieldLabel({
  htmlFor,
  id,
  optional = false,
  children,
}: {
  htmlFor?: string;
  id?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  const content = (
    <>
      {children}
      {optional ? <span className="font-medium text-text-muted"> (opsional)</span> : null}
    </>
  );
  return htmlFor === undefined ? (
    <span id={id} className="text-meta font-semibold text-text-soft">
      {content}
    </span>
  ) : (
    <label htmlFor={htmlFor} id={id} className="text-meta font-semibold text-text-soft">
      {content}
    </label>
  );
}

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

/** Kotak field 48 px; galat = garis 2 px danger, fokus = garis 2 px focus. */
export function fieldShell(error: boolean, size: 'md' | 'sm' = 'md'): string {
  return `flex ${size === 'md' ? 'min-h-12' : 'min-h-11'} items-center gap-2 rounded-lg bg-bg text-text ${
    error
      ? 'border-2 border-danger'
      : 'border border-border focus-within:border-2 focus-within:border-focus'
  }`;
}
