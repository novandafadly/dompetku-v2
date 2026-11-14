'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button, buttonClass } from '@/components/ui/button';
import { CircleNotchIcon } from '@/components/ui/icons/circle-notch';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { WarningIcon } from '@/components/ui/icons/warning';

/** Bagian formulir sheet Patungan (Lunasi, Terima): tombol simpan, kotak peringatan, tanpa dompet. */

/** Tombol footer sheet: spinner + `Menyimpan…`, `aria-disabled` (fokus tidak lepas). */
export function SaveButton({
  formId,
  saving,
  label,
}: {
  formId: string;
  saving: boolean;
  label: string;
}) {
  return (
    <Button
      type="submit"
      form={formId}
      aria-disabled={saving || undefined}
      aria-busy={saving || undefined}
      className="w-full aria-disabled:border-hairline aria-disabled:bg-surface-2 aria-disabled:text-text-muted aria-disabled:hover-pointer:bg-surface-2"
    >
      {saving ? (
        <>
          <CircleNotchIcon size={18} weight="bold" className="shrink-0 motion-safe:animate-spin" />
          Menyimpan…
        </>
      ) : (
        label
      )}
    </Button>
  );
}

/** Kotak `warning-tint` (bukan galat): saldo kurang, nominal dari data dompet. */
export function WarningBox({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-lg bg-warning-tint p-3 text-label font-semibold text-warning"
    >
      <WarningIcon size={18} weight="fill" className="mt-px shrink-0" />
      <span className="text-pretty">{children}</span>
    </p>
  );
}

/** Tanpa dompet Pribadi: teks + tautan Tambah dompet (di Pribadi). */
export function NoAccountBlock({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-start gap-3 pb-1">
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-toast bg-accent-tint text-accent-text"
      >
        <WalletIcon size={24} />
      </span>
      <p className="text-body font-semibold text-text text-pretty">{text}</p>
      <Link href="/pribadi/dompet?tambah=1" className={buttonClass('primary', 'md', 'w-full')}>
        Tambah dompet
      </Link>
    </div>
  );
}
