'use client';

import { Button } from './button';
import { CircleNotchIcon } from './icons/circle-notch';

/** Tombol footer sheet: spinner + `Menyimpan…`, `aria-disabled` (fokus tidak lepas). */
export function SaveButton({
  formId,
  saving,
  label,
  disabled = false,
}: {
  formId: string;
  saving: boolean;
  label: string;
  /** Tidak bisa disimpan (mis. tanpa dompet di mode Baru): `aria-disabled`, fokus tidak lepas. */
  disabled?: boolean;
}) {
  return (
    <Button
      type="submit"
      form={formId}
      aria-disabled={saving || disabled || undefined}
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
