'use client';

import type { IsoDate } from '@dompetku/domain';
import { useRouter } from 'next/navigation';
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { newClientId } from '@/features/ledger/client-id';
import type { ActionResult, LedgerErrorCode } from '@/features/ledger/types';
import { PATUNGAN_COPY as C, receivedToast, settledToast } from '@/features/ledger/patungan-copy';
import { patunganRestoreFailedText } from '@/features/patungan/galat';
import { useOpenCatat, usePreloadCatat } from '@/features/shell/catat';
import type {
  SplitBalanceVM,
  SplitBillVM,
  SplitHistoryItemVM,
  SplitSettlementVM,
  WalletsState,
} from '@/features/ledger/patungan-types';
import type { ReceiveResult, ReceiveSubmit, ReceivedInfo } from '@/features/patungan/receive-sheet';
import type { SettleResult, SettleSubmit, SettledInfo } from '@/features/patungan/settle-sheet';
import {
  patunganWalletsAction,
  receiveSettlementAction,
  restoreSplitAction,
  settleSplitAction,
  voidReceiptAction,
  voidSettlementAction,
  voidSplitAction,
} from '../_actions/patungan';
import { restoreFocus } from './focus-title';
import { PATUNGAN_TITLE_ID } from './patungan-ids';

/**
 * Pulau klien Patungan nyata (S12; dimuat malas lewat `patungan-islands`). `PatunganHost` memegang
 * state sheet/dialog; pemicunya (Lunasi, Terima, Hapus, Batalkan, Pulihkan) membungkus isi Server
 * Component sebagai `children`. Sheet dan dialog dimuat saat pertama dipakai. Dompet Pribadi
 * penonton dimuat malas lewat action (R27: tidak lewat props rute Bersama) dan dibuang tiap ada
 * perubahan uang (saldo berubah). Server Action `mutate` memanggil `refresh()`, jadi halaman tampil
 * ulang tanpa navigasi.
 */

const loadSettle = () => import('@/features/patungan/settle-sheet');
const SettleSheet = lazy(() => loadSettle().then((m) => ({ default: m.SettleSheet })));
const loadReceive = () => import('@/features/patungan/receive-sheet');
const ReceiveSheet = lazy(() => loadReceive().then((m) => ({ default: m.ReceiveSheet })));
const loadDialogs = () => import('@/features/patungan/patungan-dialogs');
const DeleteDialog = lazy(() => loadDialogs().then((m) => ({ default: m.DeleteSplitDialog })));
const CancelDialog = lazy(() => loadDialogs().then((m) => ({ default: m.CancelSettlementDialog })));
const preloadSettle = () => {
  void loadSettle();
};
const preloadReceive = () => {
  void loadReceive();
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

type DialogKind = 'delete' | 'cancel-settle' | 'cancel-receipt';

interface HostApi {
  openSettle: () => void;
  openReceive: (settlementId: string) => void;
  openDialog: (kind: DialogKind, id: string) => void;
  restore: (splitId: string) => Promise<string | null>;
}
const Host = createContext<HostApi | null>(null);

function useHost(): HostApi {
  const h = useContext(Host);
  if (h === null) throw new Error('pemicu Patungan harus di dalam PatunganHost');
  return h;
}

export interface PatunganHostProps {
  today: IsoDate;
  balance: SplitBalanceVM;
  /** Semua baris halaman ini (hidup dan dihapus): sasaran dialog dan pemulihan. */
  items: SplitHistoryItemVM[];
  /** Buka sheet saat dimuat (`?lunasi=1`, `?terima=id`), dari tautan kartu Beranda. */
  initial: { lunasi: boolean; terima: string | null };
  children: ReactNode;
}

const IDLE: WalletsState = { status: 'idle', data: null };
const LOADING: WalletsState = { status: 'loading', data: null };

export function PatunganHost({ today, balance, items, initial, children }: PatunganHostProps) {
  const router = useRouter();
  // Dibuka dari tautan Beranda (`?lunasi=1`, `?terima=id`): keadaan awal, bukan efek.
  const fromLink = initial.lunasi || initial.terima !== null;
  const [wallets, setWallets] = useState<WalletsState>(fromLink ? LOADING : IDLE);
  const [settleOpen, setSettleOpen] = useState(initial.lunasi);
  const [receiveOpen, setReceiveOpen] = useState(!initial.lunasi && initial.terima !== null);
  const [receiveId, setReceiveId] = useState<string | null>(initial.lunasi ? null : initial.terima);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialog, setDialog] = useState<{ kind: DialogKind; id: string } | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogFailure, setDialogFailure] = useState<LedgerErrorCode | null>(null);
  // Batal penerimaan: sekali `saldo_negatif` ditolak, `Tetap batalkan` bertahan (kirim allowNegative).
  const [forceCancel, setForceCancel] = useState(false);
  const dialogClientId = useRef('');
  const running = useRef(false);
  const loading = useRef(false);
  const settleMounted = useOpenedOnce(settleOpen);
  const receiveMounted = useOpenedOnce(receiveOpen);
  const dialogMounted = useOpenedOnce(dialogOpen);

  /** Ambil dompet Pribadi; keadaan hanya berubah saat jawaban tiba (bukan sinkron di efek). */
  function fetchWallets() {
    if (loading.current) return;
    loading.current = true;
    void call(() => patunganWalletsAction('bersama')).then((res) => {
      loading.current = false;
      setWallets(res.ok ? { status: 'ready', data: res.value } : { status: 'error', data: null });
    });
  }
  function loadWallets(force = false) {
    if (loading.current) return;
    if (!force && wallets.status !== 'idle' && wallets.status !== 'error') return;
    setWallets(LOADING);
    fetchWallets();
  }
  /** Saldo dompet berubah: buang dompet yang dimuat; dimuat lagi saat dibutuhkan. */
  function invalidate() {
    setWallets(IDLE);
  }

  function openSettle() {
    loadWallets();
    setSettleOpen(true);
  }
  function openReceive(settlementId: string) {
    loadWallets();
    setReceiveId(settlementId);
    setReceiveOpen(true);
  }
  function openDialog(kind: DialogKind, id: string) {
    loadWallets();
    dialogClientId.current = newClientId();
    setDialogFailure(null);
    setForceCancel(false);
    setDialog({ kind, id });
    setDialogOpen(true);
  }

  // Sheet dari tautan Beranda: dompet diambil sekali, parameternya dibuang dari alamat (muat ulang
  // tidak membuka sheet lagi).
  const consumed = useRef(false);
  useEffect(() => {
    if (consumed.current || !fromLink) return;
    consumed.current = true;
    fetchWallets();
    const url = new URL(window.location.href);
    url.searchParams.delete('lunasi');
    url.searchParams.delete('terima');
    window.history.replaceState(null, '', url.pathname + url.search);
    // Sekali saat dipasang (guard `consumed` menahan efek ganda StrictMode).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = balance.pending.find((p) => p.id === receiveId) ?? null;
  const target = dialog === null ? null : (items.find((i) => i.id === dialog.id) ?? null);
  const partner = balance.partner.name;

  async function settle(input: SettleSubmit): Promise<SettleResult> {
    const res = await call(() => settleSplitAction('bersama', input));
    return res.ok
      ? { ok: true, settlementId: res.value.settlementId, amount: res.value.amount }
      : failOf(res);
  }

  function onSettled(info: SettledInfo) {
    setSettleOpen(false);
    invalidate();
    const undoId = newClientId();
    let busy = false;
    toast({
      message: settledToast(info.amount, info.accountName, partner),
      action: {
        label: C.undo,
        onAction: () => {
          if (busy) return;
          busy = true;
          void call(() =>
            voidSettlementAction('bersama', { clientId: undoId, settlementId: info.settlementId }),
          )
            .then((r) => {
              if (!r.ok) toast({ message: patunganRestoreFailedText(r.error.code), tone: 'info' });
            })
            .finally(() => {
              busy = false;
            });
        },
      },
    });
    restoreFocus(null, `#${PATUNGAN_TITLE_ID}`);
  }

  async function receive(input: ReceiveSubmit): Promise<ReceiveResult> {
    const res = await call(() => receiveSettlementAction('bersama', input));
    return res.ok
      ? { ok: true, settlementId: res.value.settlementId, amount: res.value.amount }
      : failOf(res);
  }

  function onReceived(info: ReceivedInfo) {
    setReceiveOpen(false);
    invalidate();
    const undoId = newClientId();
    let busy = false;
    toast({
      message: receivedToast(partner, info.amount, info.accountName),
      action: {
        label: C.undo,
        onAction: () => {
          if (busy) return;
          busy = true;
          void call(() =>
            voidReceiptAction('bersama', { clientId: undoId, settlementId: info.settlementId }),
          )
            .then((r) => {
              if (!r.ok) toast({ message: patunganRestoreFailedText(r.error.code), tone: 'info' });
            })
            .finally(() => {
              busy = false;
            });
        },
      },
    });
    restoreFocus(null, `#${PATUNGAN_TITLE_ID}`);
  }

  async function confirmDialog() {
    if (running.current || dialog === null) return;
    running.current = true;
    setDialogBusy(true);
    setDialogFailure(null);
    const clientId = dialogClientId.current;
    const force = forceCancel;
    const { kind, id } = dialog;
    const res =
      kind === 'delete'
        ? await call(() => voidSplitAction('bersama', { clientId, splitId: id }))
        : kind === 'cancel-settle'
          ? await call(() => voidSettlementAction('bersama', { clientId, settlementId: id }))
          : await call(() =>
              voidReceiptAction('bersama', { clientId, settlementId: id, allowNegative: force }),
            );
    running.current = false;
    setDialogBusy(false);
    if (!res.ok) {
      if (res.error.code === 'saldo_negatif') setForceCancel(true);
      setDialogFailure(res.error.code);
      return;
    }
    setDialogOpen(false);
    invalidate();
    if (kind === 'delete') {
      const undoId = newClientId();
      let busy = false;
      toast({
        message: 'Tagihan patungan dihapus di Bersama',
        action: {
          label: C.undo,
          onAction: () => {
            if (busy) return;
            busy = true;
            void call(() => restoreSplitAction('bersama', { clientId: undoId, splitId: id }))
              .then((r) => {
                if (!r.ok) {
                  toast({ message: patunganRestoreFailedText(r.error.code), tone: 'info' });
                }
              })
              .finally(() => {
                busy = false;
              });
          },
        },
      });
    } else {
      toast({
        message: kind === 'cancel-settle' ? 'Pelunasan dibatalkan' : 'Penerimaan dibatalkan',
      });
    }
    // Tombol baris itu diganti status (fokus jatuh ke body): kembali ke judul.
    restoreFocus(null, `#${PATUNGAN_TITLE_ID}`);
  }

  const dialogCommon = {
    open: dialogOpen,
    onOpenChange: (o: boolean) => {
      if (!dialogBusy) setDialogOpen(o);
    },
    balance,
    wallets,
    busy: dialogBusy,
    failure: dialogFailure,
    force: forceCancel,
    onConfirm: () => {
      void confirmDialog();
    },
  };

  const api: HostApi = {
    openSettle,
    openReceive,
    openDialog,
    async restore(splitId) {
      const res = await call(() =>
        restoreSplitAction('bersama', { clientId: newClientId(), splitId }),
      );
      if (res.ok) {
        invalidate();
        toast({ message: 'Tagihan patungan dipulihkan di Bersama' });
        restoreFocus(null, `#${PATUNGAN_TITLE_ID}`);
        return null;
      }
      return patunganRestoreFailedText(res.error.code);
    },
  };

  return (
    <Host.Provider value={api}>
      {children}
      {settleMounted ? (
        <Suspense fallback={null}>
          <SettleSheet
            open={settleOpen}
            onOpenChange={setSettleOpen}
            balance={balance}
            wallets={wallets}
            today={today}
            onSettle={settle}
            onSettled={onSettled}
            onRefresh={() => {
              router.refresh();
            }}
            onReloadWallets={() => {
              loadWallets(true);
            }}
          />
        </Suspense>
      ) : null}
      {receiveMounted ? (
        <Suspense fallback={null}>
          <ReceiveSheet
            open={receiveOpen}
            onOpenChange={setReceiveOpen}
            balance={balance}
            settlement={pending}
            wallets={wallets}
            onReceive={receive}
            onReceived={onReceived}
            onRefresh={() => {
              router.refresh();
            }}
            onReloadWallets={() => {
              loadWallets(true);
            }}
          />
        </Suspense>
      ) : null}
      {dialogMounted && dialog !== null ? (
        <Suspense fallback={null}>
          {dialog.kind === 'delete' ? (
            <DeleteDialog
              {...dialogCommon}
              bill={
                target !== null && target.item === 'split' ? (target satisfies SplitBillVM) : null
              }
            />
          ) : (
            <CancelDialog
              {...dialogCommon}
              as={dialog.kind === 'cancel-settle' ? 'settle' : 'receipt'}
              settlement={
                target !== null && target.item === 'settlement'
                  ? (target satisfies SplitSettlementVM)
                  : null
              }
            />
          )}
        </Suspense>
      ) : null}
    </Host.Provider>
  );
}

/** `Lunasi Rp …` di kartu saldo (primer, penuh). */
export function SettleButton({ label }: { label: string }) {
  const { openSettle } = useHost();
  return (
    <Button
      className="w-full"
      data-patungan-settle=""
      onPointerEnter={preloadSettle}
      onFocus={preloadSettle}
      onClick={openSettle}
    >
      {label}
    </Button>
  );
}

/** `Terima` pada pelunasan yang menunggu diterima (nama aksesibel memuat nama pelunas). */
export function ReceiveButton({ settlementId, label }: { settlementId: string; label: string }) {
  const { openReceive } = useHost();
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label={label}
      onPointerEnter={preloadReceive}
      onFocus={preloadReceive}
      onClick={() => {
        openReceive(settlementId);
      }}
    >
      {C.receive}
    </Button>
  );
}

/** `Hapus` / `Batalkan` di baris riwayat: dialog akibat (AK1/AK2). */
export function RowActionButton({
  kind,
  id,
  label,
  ariaLabel,
}: {
  kind: DialogKind;
  id: string;
  label: string;
  ariaLabel: string;
}) {
  const { openDialog } = useHost();
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onPointerEnter={preloadDialogs}
      onFocus={preloadDialogs}
      onClick={() => {
        openDialog(kind, id);
      }}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-label font-bold text-danger hover-pointer:bg-danger-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {label}
    </button>
  );
}

/** `Pulihkan` pada tagihan dihapus: langsung pulih (tanpa dialog); ditolak = pesan di bawah baris. */
export function RestoreSplitButton({ splitId, ariaLabel }: { splitId: string; ariaLabel: string }) {
  const { restore } = useHost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const failed = await restore(splitId);
    setBusy(false);
    setError(failed);
  }
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        aria-label={ariaLabel}
        onClick={() => {
          void run();
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

/** `Catat pengeluaran Bersama` di keadaan kosong: membuka sheet Catat. */
export function CatatButton({ label }: { label: string }) {
  const openCatat = useOpenCatat();
  const preloadCatat = usePreloadCatat();
  return (
    <Button
      onPointerEnter={preloadCatat}
      onFocus={preloadCatat}
      onClick={() => {
        openCatat();
      }}
    >
      {label}
    </Button>
  );
}
