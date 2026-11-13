'use client';

import type { IsoDate } from '@dompetku/domain';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { createContext, lazy, Suspense, useContext, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { PlusIcon } from '@/components/ui/icons/plus';
import { toast } from '@/components/ui/toast';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { newClientId } from '@/features/ledger/client-id';
import type { AccountVM, ActionResult, LedgerErrorCode, Ruang } from '@/features/ledger/types';
import {
  addedToast,
  cancelledToast,
  dateWithYear,
  deletedToast,
  paidToast,
  payRowLabel,
  restoredToast,
  savedInfoToast,
  UTANG_COPY as C,
} from '@/features/utang/copy';
import { utangRestoreFailedText } from '@/features/utang/galat';
import type { ContactVM, DebtDetailVM, DebtDirection, PayTarget } from '@/features/utang/types';
import type { AddedInfo, CreateDebtSubmit, CreateResult } from '@/features/utang/add-debt-sheet';
import type { EditResult, EditSubmit } from '@/features/utang/edit-debt-sheet';
import type { PaidInfo, PayResult, PaySubmit } from '@/features/utang/pay-debt-sheet';
import { restoreEntryAction, voidEntryAction } from '../_actions/entri';
import {
  createContactAction,
  createDebtAction,
  payDebtAction,
  restoreDebtAction,
  updateDebtInfoAction,
  voidDebtAction,
} from '../_actions/utang';
import { focusHeadingAt, restoreFocus } from './focus-title';
import { UTANG_TITLE_ID } from './utang-ids';

/**
 * Pulau klien Utang nyata (S11; dimuat malas lewat `utang-islands`, chunk TERPISAH dari
 * `rencana-client`: pengguna Anggaran/Tagihan tidak membayar byte Utang). `UtangHost` memegang
 * state sheet/dialog; pemicunya bisa di baris, header, atau keadaan kosong dan membungkus isi
 * Server Component sebagai `children`. Sheet dan dialog dimuat saat pertama dipakai (pointer/fokus
 * di pemicu memuat lebih awal). Server Action `mutate` memanggil `refresh()`, jadi daftar tampil
 * ulang tanpa navigasi. Hanya ruang Pribadi.
 */

const loadAdd = () => import('@/features/utang/add-debt-sheet');
const AddSheet = lazy(() => loadAdd().then((m) => ({ default: m.AddDebtSheet })));
const loadPay = () => import('@/features/utang/pay-debt-sheet');
const PaySheet = lazy(() => loadPay().then((m) => ({ default: m.PayDebtSheet })));
const loadEdit = () => import('@/features/utang/edit-debt-sheet');
const EditSheet = lazy(() => loadEdit().then((m) => ({ default: m.EditDebtSheet })));
const loadDialogs = () => import('@/features/utang/debt-dialogs');
const CancelDialog = lazy(() => loadDialogs().then((m) => ({ default: m.CancelPaymentDialog })));
const DeleteDialog = lazy(() => loadDialogs().then((m) => ({ default: m.DeleteDebtDialog })));
const preloadAdd = () => {
  void loadAdd();
};
const preloadPay = () => {
  void loadPay();
};
const preloadEdit = () => {
  void loadEdit();
};
const preloadDialogs = () => {
  void loadDialogs();
};

interface Fail {
  ok: false;
  code: LedgerErrorCode;
  field?: string;
}

/** Galat jaringan Server Action (fetch gagal) = `network`; kode lain diteruskan apa adanya. */
async function call<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch {
    return { ok: false, error: { code: 'network' } };
  }
}

function failOf(res: { ok: false; error: { code: LedgerErrorCode; field?: string } }): Fail {
  return res.error.field === undefined
    ? { ok: false, code: res.error.code }
    : { ok: false, code: res.error.code, field: res.error.field };
}

interface HostApi {
  ruang: Ruang;
  detail: DebtDetailVM | undefined;
  openAdd: () => void;
  openPay: (debtId: string) => void;
  openEdit: () => void;
  openCancel: (entryId: string) => void;
  openDelete: () => void;
}
const Host = createContext<HostApi | null>(null);

function useHost(): HostApi {
  const h = useContext(Host);
  if (h === null) throw new Error('pemicu Utang harus di dalam UtangHost');
  return h;
}

export interface UtangHostProps {
  ruang: Ruang;
  today: IsoDate;
  accounts: AccountVM[];
  contacts: ContactVM[];
  /** Utang di halaman ini (daftar: semua yang hidup; detail: satu). Selalu data terbaru. */
  targets: PayTarget[];
  /** Detail utang (halaman detail): sumber Ubah, Hapus, dan Batalkan pembayaran. */
  detail?: DebtDetailVM | undefined;
  /** Daftar Utang ruang ini: tujuan sesudah Hapus. */
  listHref: Route;
  children: ReactNode;
}

export function UtangHost({
  ruang,
  today,
  accounts,
  contacts,
  targets,
  detail,
  listHref,
  children,
}: UtangHostProps) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payId, setPayId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogFailure, setDialogFailure] = useState<LedgerErrorCode | null>(null);
  const dialogClientId = useRef('');
  const running = useRef(false);
  const addMounted = useOpenedOnce(addOpen);
  const payMounted = useOpenedOnce(payOpen);
  const editMounted = useOpenedOnce(editOpen);
  const cancelMounted = useOpenedOnce(cancelOpen);
  const deleteMounted = useOpenedOnce(deleteOpen);

  const api: HostApi = {
    ruang,
    detail,
    openAdd: () => {
      setAddOpen(true);
    },
    openPay: (debtId) => {
      setPayId(debtId);
      setPayOpen(true);
    },
    openEdit: () => {
      setEditOpen(true);
    },
    openCancel: (entryId) => {
      dialogClientId.current = newClientId();
      setDialogFailure(null);
      setCancelId(entryId);
      setCancelOpen(true);
    },
    openDelete: () => {
      dialogClientId.current = newClientId();
      setDialogFailure(null);
      setDeleteOpen(true);
    },
  };

  const payTarget = targets.find((t) => t.debtId === payId) ?? null;
  const cancelPayment = detail?.payments.find((p) => p.entryId === cancelId) ?? null;

  async function createDebt(input: CreateDebtSubmit): Promise<CreateResult> {
    const res = await call(() => createDebtAction(ruang, input));
    return res.ok ? { ok: true, debtId: res.value.debtId } : failOf(res);
  }

  async function pay(input: PaySubmit): Promise<PayResult> {
    const res = await call(() => payDebtAction(ruang, input));
    return res.ok
      ? {
          ok: true,
          entryId: res.value.entryId,
          version: res.value.version,
          remaining: res.value.remaining,
        }
      : failOf(res);
  }

  async function saveEdit(input: EditSubmit): Promise<EditResult> {
    let contactId = input.contactId;
    if (input.contactName !== undefined) {
      const created = await call(() =>
        createContactAction(ruang, {
          clientId: input.contactClientId,
          name: input.contactName ?? '',
        }),
      );
      if (!created.ok) return failOf(created);
      contactId = created.value.contactId;
    }
    if (contactId === undefined) return { ok: false, code: 'invalid' };
    const id = contactId;
    const res = await call(() =>
      updateDebtInfoAction(ruang, {
        debtId: input.debtId,
        contactId: id,
        title: input.title,
        note: input.note,
      }),
    );
    return res.ok ? { ok: true } : failOf(res);
  }

  /** "Urungkan" sesudah bayar: batalkan entri itu; satu clientId per toast, klik ganda aman. */
  function undoPayment(entryId: string, version: number): () => void {
    const clientId = newClientId();
    let busy = false;
    return () => {
      if (busy) return;
      busy = true;
      void call(() => voidEntryAction(ruang, { clientId, entryId, expectedVersion: version }))
        .then((res) => {
          if (!res.ok) toast({ message: C.undoFailed, tone: 'info' });
        })
        .finally(() => {
          busy = false;
        });
    };
  }

  function onPaid(info: PaidInfo) {
    setPayOpen(false);
    toast({
      message: paidToast(info.name, info.direction, info.amount, info.accountName, info.remaining),
      action: { label: C.undo, onAction: undoPayment(info.entryId, info.version) },
    });
    restoreFocus(`[data-debt-pay="${info.debtId}"]`);
  }

  function onCreated(info: AddedInfo) {
    setAddOpen(false);
    toast({
      message: addedToast(info.name, info.direction, info.mode, info.amount, info.accountName),
    });
    restoreFocus(null);
  }

  async function confirmCancel() {
    if (running.current || cancelPayment === null) return;
    running.current = true;
    setDialogBusy(true);
    setDialogFailure(null);
    const clientId = dialogClientId.current;
    const res = await call(() =>
      voidEntryAction(ruang, {
        clientId,
        entryId: cancelPayment.entryId,
        expectedVersion: cancelPayment.version,
      }),
    );
    running.current = false;
    setDialogBusy(false);
    if (!res.ok) {
      setDialogFailure(res.error.code);
      return;
    }
    setCancelOpen(false);
    const entryId = cancelPayment.entryId;
    const undoClientId = newClientId();
    let busy = false;
    toast({
      message: cancelledToast(cancelPayment.amount),
      action: {
        label: C.undo,
        onAction: () => {
          if (busy) return;
          busy = true;
          void call(() =>
            restoreEntryAction(ruang, {
              clientId: undoClientId,
              entryId,
              expectedVersion: res.value.version,
            }),
          )
            .then((r) => {
              if (!r.ok) toast({ message: utangRestoreFailedText(r.error.code), tone: 'info' });
            })
            .finally(() => {
              busy = false;
            });
        },
      },
    });
    // Tombol Batalkan baris itu diganti `Dibatalkan` (fokus jatuh ke body): kembali ke judul.
    restoreFocus(null, `#${UTANG_TITLE_ID}`);
  }

  async function confirmDelete() {
    if (running.current || detail === undefined) return;
    running.current = true;
    setDialogBusy(true);
    const force = dialogFailure === 'saldo_negatif';
    setDialogFailure(null);
    const clientId = dialogClientId.current;
    const res = await call(() =>
      voidDebtAction(ruang, { clientId, debtId: detail.debtId, allowNegative: force }),
    );
    running.current = false;
    setDialogBusy(false);
    if (!res.ok) {
      setDialogFailure(res.error.code);
      return;
    }
    setDeleteOpen(false);
    const { debtId, contactName, direction } = detail;
    const undoClientId = newClientId();
    let busy = false;
    toast({
      message: deletedToast(contactName, direction),
      action: {
        label: C.undo,
        onAction: () => {
          if (busy) return;
          busy = true;
          void call(() => restoreDebtAction(ruang, { clientId: undoClientId, debtId }))
            .then((r) => {
              if (r.ok) toast({ message: restoredToast(contactName, direction) });
              else toast({ message: utangRestoreFailedText(r.error.code), tone: 'info' });
            })
            .finally(() => {
              busy = false;
            });
        },
      },
    });
    router.push(listHref);
    focusHeadingAt(listHref);
  }

  return (
    <Host.Provider value={api}>
      {children}
      {addMounted ? (
        <Suspense fallback={null}>
          <AddSheet
            open={addOpen}
            onOpenChange={setAddOpen}
            accounts={accounts}
            contacts={contacts}
            today={today}
            onCreate={createDebt}
            onCreated={onCreated}
          />
        </Suspense>
      ) : null}
      {payMounted ? (
        <Suspense fallback={null}>
          <PaySheet
            open={payOpen}
            onOpenChange={setPayOpen}
            target={payTarget}
            accounts={accounts}
            today={today}
            onPay={pay}
            onPaid={onPaid}
            onRefresh={() => {
              router.refresh();
            }}
          />
        </Suspense>
      ) : null}
      {editMounted && detail !== undefined ? (
        <Suspense fallback={null}>
          <EditSheet
            open={editOpen}
            onOpenChange={setEditOpen}
            detail={detail}
            contacts={contacts}
            onSave={saveEdit}
            onSaved={(name) => {
              setEditOpen(false);
              toast({ message: savedInfoToast(name, detail.direction) });
              // Tombol Batalkan baris itu diganti `Dibatalkan` (fokus jatuh ke body): kembali ke judul.
              restoreFocus(null, `#${UTANG_TITLE_ID}`);
            }}
          />
        </Suspense>
      ) : null}
      {cancelMounted && detail !== undefined ? (
        <Suspense fallback={null}>
          <CancelDialog
            open={cancelOpen}
            onOpenChange={(o) => {
              if (!dialogBusy) setCancelOpen(o);
            }}
            payment={cancelPayment}
            detail={detail}
            account={accounts.find((a) => a.id === cancelPayment?.accountId)}
            busy={dialogBusy}
            failure={dialogFailure}
            onConfirm={() => {
              void confirmCancel();
            }}
          />
        </Suspense>
      ) : null}
      {deleteMounted && detail !== undefined ? (
        <Suspense fallback={null}>
          <DeleteDialog
            open={deleteOpen}
            onOpenChange={(o) => {
              if (!dialogBusy) setDeleteOpen(o);
            }}
            detail={detail}
            busy={dialogBusy}
            failure={dialogFailure}
            onConfirm={() => {
              void confirmDelete();
            }}
          />
        </Suspense>
      ) : null}
    </Host.Provider>
  );
}

/** `Tambah utang`: sheet kosong (header laptop, keadaan kosong, tombol HP). */
export function AddDebtButton({
  variant,
  plus = false,
  className = '',
}: {
  variant: 'primary' | 'secondary';
  plus?: boolean;
  className?: string;
}) {
  const { openAdd } = useHost();
  return (
    <Button
      variant={variant}
      className={className}
      onPointerEnter={preloadAdd}
      onFocus={preloadAdd}
      onClick={openAdd}
    >
      {plus ? <PlusIcon size={18} weight="bold" /> : null}
      {C.add}
    </Button>
  );
}

/** `Bayar` / `Terima` pada baris: sheet Bayar utang itu. Nama aksesibel diawali kata terlihat. */
export function PayRowButton({
  debtId,
  name,
  direction,
}: {
  debtId: string;
  name: string;
  direction: DebtDirection;
}) {
  const { openPay } = useHost();
  return (
    <Button
      variant="secondary"
      size="sm"
      data-debt-pay={debtId}
      aria-label={payRowLabel(direction, name)}
      onPointerEnter={preloadPay}
      onFocus={preloadPay}
      onClick={() => {
        openPay(debtId);
      }}
    >
      {direction === 'lent' ? C.receive : C.pay}
    </Button>
  );
}

/** Aksi detail: `Bayar utang` / `Terima pembayaran` (primer, penuh). */
export function PayDetailButton({
  debtId,
  direction,
}: {
  debtId: string;
  direction: DebtDirection;
}) {
  const { openPay } = useHost();
  return (
    <Button
      className="w-full"
      data-debt-pay={debtId}
      onPointerEnter={preloadPay}
      onFocus={preloadPay}
      onClick={() => {
        openPay(debtId);
      }}
    >
      {direction === 'lent' ? C.receivePayment : C.payDebt}
    </Button>
  );
}

export function EditDebtButton() {
  const { openEdit } = useHost();
  return (
    <Button
      variant="secondary"
      size="sm"
      className="w-full"
      onPointerEnter={preloadEdit}
      onFocus={preloadEdit}
      onClick={openEdit}
    >
      {C.edit}
    </Button>
  );
}

/** `Hapus utang`: tombol teks bahaya; membuka dialog akibat (AK2). */
export function DeleteDebtButton() {
  const { openDelete } = useHost();
  return (
    <button
      type="button"
      onPointerEnter={preloadDialogs}
      onFocus={preloadDialogs}
      onClick={openDelete}
      className="inline-flex min-h-11 w-full items-center justify-center rounded-lg px-3 text-label font-bold text-danger hover-pointer:bg-danger-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {C.deleteDebt}
    </button>
  );
}

/** `Batalkan` di baris riwayat: dialog AK1. Nama aksesibel memuat tanggal pembayaran. */
export function CancelPaymentButton({
  entryId,
  occurredOn,
}: {
  entryId: string;
  occurredOn: IsoDate;
}) {
  const { openCancel } = useHost();
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label={`Batalkan pembayaran ${dateWithYear(occurredOn)}`}
      onPointerEnter={preloadDialogs}
      onFocus={preloadDialogs}
      onClick={() => {
        openCancel(entryId);
      }}
    >
      {C.cancel}
    </Button>
  );
}

/**
 * `Pulihkan` pada utang dihapus (K5): langsung `restore_debt`, tanpa dialog; semua efek kembali.
 * Ditolak (saldo dompet pembayaran tidak cukup, dll.) = pesan di bawah baris.
 */
export function RestoreDebtButton({
  debtId,
  name,
  direction,
}: {
  debtId: string;
  name: string;
  direction: DebtDirection;
}) {
  const { ruang } = useHost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientId = useRef(newClientId());
  async function restore() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await call(() => restoreDebtAction(ruang, { clientId: clientId.current, debtId }));
    setBusy(false);
    if (res.ok) {
      toast({ message: restoredToast(name, direction) });
      restoreFocus(null);
    } else {
      setError(utangRestoreFailedText(res.error.code));
    }
  }
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        aria-label={`${C.restore} ${direction === 'lent' ? 'piutang pada' : 'utang ke'} ${name}`}
        onClick={() => {
          void restore();
        }}
      >
        {C.restore}
      </Button>
      {error === null ? null : (
        <p role="alert" className="basis-full pb-2 text-label font-semibold text-danger">
          {error}
        </p>
      )}
    </>
  );
}
