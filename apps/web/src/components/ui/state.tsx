import type { ReactNode } from 'react';
import { Button } from './button';

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-sheet border border-hairline bg-surface p-6 text-center">
      <p className="text-lg font-semibold text-text">{title}</p>
      {description ? <p className="text-base text-text-muted">{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Terjadi kesalahan',
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-sheet border border-danger bg-surface p-6 text-center"
    >
      <p className="text-lg font-semibold text-danger">{title}</p>
      {description ? <p className="text-base text-text-muted">{description}</p> : null}
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Coba lagi
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-skeleton=""
      className={`animate-pulse rounded-field bg-surface-2 ${className}`}
    />
  );
}
