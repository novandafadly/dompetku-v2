'use client';

import { formatRupiah, type IsoDate, type Rupiah } from '@dompetku/domain';
import { useRouter } from 'next/navigation';
import { createContext, lazy, Suspense, useContext, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { InfoIcon } from '@/components/ui/icons/info';
import { PlusIcon } from '@/components/ui/icons/plus';
import { focusRing } from '@/components/ui/styles';
import { toast } from '@/components/ui/toast';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { newClientId } from '@/features/ledger/client-id';
import { undoOrNotify } from '@/features/catat/saved-toast';
import type { AccountVM, ActionResult, CategoryVM, Ruang } from '@/features/ledger/types';
import { TAGIHAN_COPY } from '@/features/rencana/copy';
import { RENCANA_COPY } from '@/features/rencana/copy';
import type { BudgetResult, BudgetSubmit } from '@/features/rencana/budget-sheet';
import type { BillItem } from '@/features/rencana/bills';
import type { BillResult } from '@/features/rencana/bill-sheet';
import type { PayResult } from '@/features/rencana/pay-bill-sheet';
import type { BillDueVM, BillListVM, BudgetOverviewVM } from '@/features/rencana/types';
import { restoreFocus } from './focus-title';
import { voidEntryAction } from '../_actions/entri';
import {
  archiveBillAction,
  copyBudgetsAction,
  createBillAction,
  deleteBudgetAction,
  payBillAction,
  setBudgetAction,
  skipBillAction,
  unskipBillAction,
  updateBillAction,
} from '../_actions/rencana';

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
const loadBillSheet = () => import('@/features/rencana/bill-sheet');
const BillSheet = lazy(() => loadBillSheet().then((m) => ({ default: m.BillSheet })));
const loadPaySheet = () => import('@/features/rencana/pay-bill-sheet');
const PayBillSheet = lazy(() => loadPaySheet().then((m) => ({ default: m.PayBillSheet })));
const preloadBill = () => {
  void loadBillSheet();
};
const preloadPay = () => {
  void loadPaySheet();
};

interface HostApi {
  ruang: Ruang;
  month: string;
  openBudget: (categoryId: string | null) => void;
  /** Sheet rincian baru untuk satu induk (S10). */
  openSub: (parentId: string) => void;
  openBill: (billId: string | null, occurrenceId?: string) => void;
  openPay: (occurrenceId: string) => void;
  unskip: (occurrenceId: string, name: string) => void;
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

/** Data Tagihan untuk sheet Tambah/Ubah dan Bayar (ruang ini saja; Bersama tanpa data Pribadi). */
export interface BillHostData {
  bills: BillListVM[];
  /** Kemunculan terlihat (periode ini + berikutnya). */
  occurrences: BillDueVM[];
  accounts: AccountVM[];
  categories: CategoryVM[];
  today: IsoDate;
  /** rootCategoryId → ada anggaran wajib periode ini (salinan `obligation_double`). */
  wajibRoots: Record<string, true>;
}

async function runPay(
  fn: () => Promise<ActionResult<{ entryId: string; version: number }>>,
): Promise<PayResult> {
  try {
    const res = await fn();
    if (res.ok) return { ok: true, entryId: res.value.entryId, version: res.value.version };
    return res.error.field === undefined
      ? { ok: false, code: res.error.code }
      : { ok: false, code: res.error.code, field: res.error.field };
  } catch {
    return { ok: false, code: 'network' };
  }
}

/** Bentuk sama dengan `run`, untuk aksi tagihan yang hasilnya tidak dipakai (hanya ok/kode). */
async function runBill(fn: () => Promise<ActionResult<unknown>>): Promise<BillResult> {
  return run(fn);
}

/** "Urungkan" sesudah bayar: void entri versi hasil bayar; satu clientId per toast, klik ganda aman. */
function undoPayment(ruang: Ruang, entryId: string, version: number): () => void {
  const clientId = newClientId();
  let running = false;
  return () => {
    if (running) return;
    running = true;
    void undoOrNotify(
      async (v: number) => {
        const res = await voidEntryAction(ruang, { clientId, entryId, expectedVersion: v });
        return res.ok;
      },
      version,
      toast,
      TAGIHAN_COPY.undoFailed,
    ).finally(() => {
      running = false;
    });
  };
}

/** `Batalkan lewati` (tombol baris, `announce`) atau "Urungkan" sesudah Lewati. */
async function unskipOccurrence(
  ruang: Ruang,
  occurrenceId: string,
  name: string,
  announce: boolean,
): Promise<void> {
  let ok = false;
  try {
    ok = (await unskipBillAction(ruang, occurrenceId)).ok;
  } catch {
    ok = false;
  }
  if (!ok) {
    toast({
      message: announce ? TAGIHAN_COPY.errUnskip : TAGIHAN_COPY.undoSkipFailed,
      tone: 'info',
    });
    return;
  }
  if (announce) toast({ message: TAGIHAN_COPY.unskipped(name, ruang) });
}

export interface RencanaHostProps {
  ruang: Ruang;
  /** Label periode berjalan `YYYY-MM`. */
  month: string;
  /** `23 Okt – 24 Nov`. */
  range: string;
  rows: BudgetOverviewVM[];
  /** Rincian (S10): beranggaran, atau aktif dari induk beranggaran. */
  subRows?: BudgetOverviewVM[] | undefined;
  previous: Record<string, Rupiah>;
  billNameByRoot: Record<string, string>;
  /** Data Tagihan; tanpa ini pemicu Tagihan tidak berbuat apa-apa. */
  bill?: BillHostData | undefined;
  children: ReactNode;
}

export function RencanaHost({
  ruang,
  month,
  range,
  rows,
  subRows = [],
  previous,
  billNameByRoot,
  bill,
  children,
}: RencanaHostProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [billTarget, setBillTarget] = useState<string | null>(null);
  // Baris kemunculan yang diketuk: fokus kembali ke sana (bukan baris pertama tagihan itu).
  const [billOcc, setBillOcc] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<(BillItem & { occ: BillDueVM }) | null>(null);
  const billMounted = useOpenedOnce(billOpen);
  const payMounted = useOpenedOnce(payOpen);
  // Kategori sheet bertahan sesudah ditutup (animasi tutup memakai isi yang sama).
  const [target, setTarget] = useState<string | null>(null);
  const [subParent, setSubParent] = useState<string | null>(null);
  const [conflict, setConflict] = useState(0);
  const mounted = useOpenedOnce(open);
  const api: HostApi = {
    ruang,
    month,
    openBudget: (categoryId) => {
      setTarget(categoryId);
      setSubParent(null);
      setOpen(true);
    },
    openSub: (parentId) => {
      setTarget(null);
      setSubParent(parentId);
      setOpen(true);
    },
    openBill: (billId, occurrenceId) => {
      setBillTarget(billId);
      setBillOcc(occurrenceId ?? null);
      setBillOpen(true);
    },
    openPay: (occurrenceId) => {
      const occ = bill?.occurrences.find((o) => o.occurrenceId === occurrenceId);
      const b = occ === undefined ? undefined : bill?.bills.find((x) => x.billId === occ.billId);
      if (occ === undefined || b === undefined) return;
      setPayTarget({ occ, bill: b });
      setPayOpen(true);
    },
    unskip: (occurrenceId, name) => {
      void unskipOccurrence(ruang, occurrenceId, name, true);
    },
    conflict,
    setConflict,
  };
  // Sesudah Ubah id kemunculan terbuka berganti: jatuh ke baris pertama tagihan itu.
  const focusBill = (billId: string | null, occurrenceId: string | null = null) => {
    restoreFocus(
      occurrenceId === null ? null : `[data-occ-row="${occurrenceId}"]`,
      billId === null ? null : `[data-bill-row="${billId}"]`,
    );
  };
  const editing =
    billTarget === null ? null : (bill?.bills.find((b) => b.billId === billTarget) ?? null);
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
            subRows={subRows}
            parentId={subParent}
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
      {bill !== undefined && billMounted ? (
        <Suspense fallback={null}>
          <BillSheet
            open={billOpen}
            onOpenChange={setBillOpen}
            ruang={ruang}
            bill={editing}
            accounts={bill.accounts}
            categories={bill.categories}
            today={bill.today}
            wajibRoots={bill.wajibRoots}
            onCreate={(input) => runBill(() => createBillAction(ruang, input))}
            onUpdate={(input) => runBill(() => updateBillAction(ruang, input))}
            onArchive={(billId) => runBill(() => archiveBillAction(ruang, billId))}
            onChanged={(billId) => {
              focusBill(billId, billOcc);
            }}
            onReload={() => {
              setBillOpen(false);
              router.refresh();
            }}
          />
        </Suspense>
      ) : null}
      {bill !== undefined && payMounted ? (
        <Suspense fallback={null}>
          <PayBillSheet
            open={payOpen}
            onOpenChange={setPayOpen}
            ruang={ruang}
            item={payTarget}
            accounts={bill.accounts}
            today={bill.today}
            onPay={(input) => runPay(() => payBillAction(ruang, input))}
            onSkip={(occurrenceId) => runBill(() => skipBillAction(ruang, occurrenceId))}
            onPaid={(info) => {
              setPayOpen(false);
              toast({
                message: TAGIHAN_COPY.paid(
                  info.name,
                  ruang,
                  formatRupiah(info.amount),
                  info.accountName,
                ),
                action: {
                  label: TAGIHAN_COPY.undo,
                  onAction: undoPayment(ruang, info.entryId, info.version),
                },
              });
              focusBill(payTarget?.bill.billId ?? null, payTarget?.occ.occurrenceId ?? null);
            }}
            onSkipped={(name, occurrenceId) => {
              setPayOpen(false);
              toast({
                message: TAGIHAN_COPY.skipped(name, ruang),
                action: {
                  label: TAGIHAN_COPY.undo,
                  onAction: () => {
                    void unskipOccurrence(ruang, occurrenceId, name, false);
                  },
                },
              });
              focusBill(payTarget?.bill.billId ?? null, payTarget?.occ.occurrenceId ?? null);
            }}
            onReload={() => {
              setPayOpen(false);
              router.refresh();
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

/** `Tambah rincian` di bawah daftar rincian satu induk: sheet rincian baru, induk terkunci. */
export function AddSubButton({
  parentId,
  parentName,
  className,
}: {
  parentId: string;
  parentName: string;
  className: string;
}) {
  const { openSub } = useHost();
  return (
    <button
      type="button"
      className={`${className} ${focusRing}`}
      aria-label={RENCANA_COPY.addSubFor(parentName)}
      onPointerEnter={preloadSheet}
      onFocus={preloadSheet}
      onClick={() => {
        openSub(parentId);
      }}
    >
      <PlusIcon size={16} weight="bold" />
      {RENCANA_COPY.addSub}
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
        skippedParent: number;
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
      const skipped = v.skippedExisting + v.skippedConflict + v.skippedArchived + v.skippedParent;
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

/** Badan baris tagihan: membuka sheet Ubah. */
export function BillBodyTrigger({
  billId,
  occurrenceId,
  className,
  children,
}: {
  billId: string;
  occurrenceId?: string | undefined;
  className: string;
  children: ReactNode;
}) {
  const { openBill } = useHost();
  return (
    <button
      type="button"
      data-bill-row={billId}
      data-occ-row={occurrenceId}
      className={className}
      onPointerEnter={preloadBill}
      onFocus={preloadBill}
      onClick={() => {
        openBill(billId, occurrenceId);
      }}
    >
      {children}
    </button>
  );
}

/** `Tambah tagihan`: sheet kosong. */
export function AddBillButton({
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
  const { openBill } = useHost();
  return (
    <Button
      variant={variant}
      className={className}
      onPointerEnter={preloadBill}
      onFocus={preloadBill}
      onClick={() => {
        openBill(null);
      }}
    >
      {plus ? <PlusIcon size={18} weight="bold" /> : null}
      {label}
    </Button>
  );
}

/** `Bayar` pada baris: sheet Bayar kemunculan itu. Nama aksesibel memuat nominal. */
export function PayButton({
  occurrenceId,
  billName,
  amountText,
}: {
  occurrenceId: string;
  billName: string;
  amountText: string;
}) {
  const { openPay } = useHost();
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label={`${TAGIHAN_COPY.pay} ${billName}, ${amountText}`}
      onPointerEnter={preloadPay}
      onFocus={preloadPay}
      onClick={() => {
        openPay(occurrenceId);
      }}
    >
      {TAGIHAN_COPY.pay}
    </Button>
  );
}

/** `Batalkan lewati` pada baris yang dilewati (K4). */
export function UnskipButton({
  occurrenceId,
  billName,
}: {
  occurrenceId: string;
  billName: string;
}) {
  const { unskip } = useHost();
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label={`${TAGIHAN_COPY.unskip} ${billName}`}
      onClick={() => {
        unskip(occurrenceId, billName);
      }}
    >
      {TAGIHAN_COPY.unskip}
    </Button>
  );
}
