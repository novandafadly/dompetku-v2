import type { ReactNode } from 'react';

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

/** Kotak field 48 px; galat = garis 2 px danger, fokus = garis 2 px focus. */
export function fieldShell(error: boolean, size: 'md' | 'sm' = 'md'): string {
  return `flex ${size === 'md' ? 'min-h-12' : 'min-h-11'} items-center gap-2 rounded-lg bg-bg text-text ${
    error
      ? 'border-2 border-danger'
      : 'border border-border focus-within:border-2 focus-within:border-focus'
  }`;
}
