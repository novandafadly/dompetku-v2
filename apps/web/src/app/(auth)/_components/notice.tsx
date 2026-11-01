import type { ReactNode } from 'react';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';

/**
 * Pesan hasil form auth: ikon + teks (bukan warna saja). `error` = role alert (dibacakan
 * segera), `ok` = role status.
 */
export function Notice({ tone, children }: { tone: 'ok' | 'error'; children: ReactNode }) {
  const error = tone === 'error';
  return (
    <p
      role={error ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-xl border p-4 text-body font-medium text-pretty ${
        error ? 'border-danger bg-danger-tint text-text' : 'border-hairline bg-surface-2 text-text'
      }`}
    >
      {error ? (
        <WarningCircleIcon size={20} weight="fill" className="mt-0.5 shrink-0 text-danger" />
      ) : (
        <CheckCircleIcon size={20} weight="fill" className="mt-0.5 shrink-0 text-accent-text" />
      )}
      <span>{children}</span>
    </p>
  );
}
