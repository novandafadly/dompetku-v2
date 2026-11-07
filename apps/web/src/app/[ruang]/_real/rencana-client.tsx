'use client';

import type { Rupiah } from '@dompetku/domain';
import { createContext, lazy, Suspense, useContext, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { InfoIcon } from '@/components/ui/icons/info';
import { PlusIcon } from '@/components/ui/icons/plus';
import { toast } from '@/components/ui/toast';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import type { ActionResult, Ruang } from '@/features/ledger/types';
import { RENCANA_COPY } from '@/features/rencana/copy';
import type { BudgetResult, BudgetSubmit } from '@/features/rencana/budget-sheet';
import type { BudgetOverviewVM } from '@/features/rencana/types';
import { restoreFocus } from './focus-title';
import { copyBudgetsAction, deleteBudgetAction, setBudgetAction } from '../_actions/rencana';

/**
 * Pulau klien Rencana nyata (dimuat malas lewat `rencana-islands`). `RencanaHost` memegang state
 * sheet Anggaran; tombol pembukanya (`BudgetRowTrigger`, `SetBudgetButton`) bisa di baris, header,
 * atau keadaan kosong, dan membungkus isi Server Component sebagai `children`. Sheet dimuat saat
 * pertama dipakai (pointer/fokus di pemicu memuat lebih awal). Server Action `mutate` memanggil
 * `refresh()`, jadi daftar tampil ulang tanpa navigasi.
 */

const loadSheet = () => import('@/features/rencana/budget-sheet');
const BudgetSheet = lazy(() => loadSheet().then((m) => ({ default: m.BudgetSheet })));
const preloadSheet = () => {
  void loadSheet();
};

interface HostApi {
  ruang: Ruang;
  month: string;
  openBudget: (categoryId: string | null) => void;
  conflict: number;
  setConflict: (n: number) => void;
}
const Host = createContext<HostApi | null>(null);

function useHost(): HostApi {
  const h = useContext(Host);
  if (h === null) throw new Error('pemicu Rencana harus di dalam RencanaHost');
  return h;
}

/** Galat jaringan Server Action (fetch gagal) = `network`; kode lain diteruskan apa adanya. */
async function run(fn: () => Promise<ActionResult<unknown>>): Promise<BudgetResult> {
  try {
    const res = await fn();
    if (res.ok) return { ok: true };
    return res.error.field === undefined
      ? { ok: false, code: res.error.code }
      : { ok: false, code: res.error.code, field: res.error.field };
  } catch {
    return { ok: false, code: 'network' };
  }
}

export interface RencanaHostProps {
  ruang: Ruang;
  /** Label periode berjalan `YYYY-MM`. */
  month: string;
  /** `23 Okt – 24 Nov`. */
  range: string;
  rows: BudgetOverviewVM[];
  previous: Record<string, Rupiah>;
  billNameByRoot: Record<string, string>;
  children: ReactNode;
}

export function RencanaHost({
  ruang,
  month,
  range,
  rows,
  previous,
  billNameByRoot,
  children,
}: RencanaHostProps) {
  const [open, setOpen] = useState(false);
  // Kategori sheet bertahan sesudah ditutup (animasi tutup memakai isi yang sama).
  const [target, setTarget] = useState<string | null>(null);
  const [conflict, setConflict] = useState(0);
  const mounted = useOpenedOnce(open);
  const api: HostApi = {
    ruang,
    month,
    openBudget: (categoryId) => {
      setTarget(categoryId);
      setOpen(true);
    },
    conflict,
    setConflict,
  };
  return (
    <Host.Provider value={api}>
      {children}
      {mounted ? (
        <Suspense fallback={null}>
          <BudgetSheet
            open={open}
            onOpenChange={setOpen}
            ruang={ruang}
            rows={rows}
            categoryId={target}
            range={range}
            previous={previous}
            billNameByRoot={billNameByRoot}
            onSubmit={(input: BudgetSubmit) =>
              run(() => setBudgetAction(ruang, { ...input, month }))
            }
            onDelete={(categoryId) => run(() => deleteBudgetAction(ruang, { categoryId, month }))}
            onChanged={(categoryId) => {
              // Catatan bentrok salinan basi sesudah atur/hapus; fokus tidak jatuh ke <body>.
              setConflict(0);
              restoreFocus(`[data-budget-row="${categoryId}"]`);
            }}
          />
        </Suspense>
      ) : null}
    </Host.Provider>
  );
}

/** Seluruh baris anggaran sebagai satu tombol yang membuka sheet kategori itu. */
export function BudgetRowTrigger({
  categoryId,
  className,
  children,
}: {
  categoryId: string;
  className: string;
  children: ReactNode;
}) {
  const { openBudget } = useHost();
  return (
    <button
      type="button"
      data-budget-row={categoryId}
      className={className}
      onPointerEnter={preloadSheet}
      onFocus={preloadSheet}
      onClick={() => {
        openBudget(categoryId);
      }}
    >
      {children}
    </button>
  );
}

/** `Atur anggaran` / `Atur anggaran pertama`: sheet kosong. */
export function SetBudgetButton({
  label,
  variant,
  plus = false,
  className = '',
}: {
  label: string;
  variant: 'primary' | 'secondary';
  plus?: boolean;
  className?: string;
}) {
  const { openBudget } = useHost();
  return (
    <Button
      variant={variant}
      className={className}
      onPointerEnter={preloadSheet}
      onFocus={preloadSheet}
      onClick={() => {
        openBudget(null);
      }}
    >
      {plus ? <PlusIcon size={18} weight="bold" /> : null}
      {label}
    </Button>
  );
}

/** K13: `Salin anggaran periode lalu`; hasil lewat toast, anggaran bentrok tagihan lewat catatan. */
export function CopyBudgetsButton() {
  const { ruang, month, setConflict } = useHost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let res: ActionResult<{
        copied: number;
        skippedExisting: number;
        skippedConflict: number;
        skippedArchived: number;
      }>;
      try {
        res = await copyBudgetsAction(ruang, { toMonth: month });
      } catch {
        setError(RENCANA_COPY.errCopyNetwork);
        return;
      }
      if (!res.ok) {
        setError(
          res.error.code === 'network' ? RENCANA_COPY.errCopyNetwork : RENCANA_COPY.errCopyServer,
        );
        return;
      }
      const v = res.value;
      const skipped = v.skippedExisting + v.skippedConflict + v.skippedArchived;
      setConflict(v.skippedConflict);
      restoreFocus(null);
      toast({
        message:
          v.copied > 0
            ? RENCANA_COPY.copied(v.copied, ruang, skipped)
            : RENCANA_COPY.copyNothing(ruang),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        onPointerEnter={preloadSheet}
        onClick={() => {
          void copy();
        }}
      >
        {RENCANA_COPY.copy}
      </Button>
      {error === null ? null : (
        <p role="alert" className="text-label font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Anggaran wajib yang tidak ikut tersalin karena kategorinya sudah punya tagihan (K13). */
export function CopyConflictNote() {
  const { conflict } = useHost();
  if (conflict <= 0) return null;
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-xl border border-hairline bg-surface p-4 text-label font-medium text-text-soft"
    >
      <InfoIcon size={18} className="mt-px shrink-0" />
      <span className="text-pretty">{RENCANA_COPY.copyConflict(conflict)}</span>
    </p>
  );
}
