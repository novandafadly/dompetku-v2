'use client';

import { formatRupiah, type IsoDate } from '@dompetku/domain';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { lazy, Suspense, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowCounterClockwiseIcon } from '@/components/ui/icons/arrow-counter-clockwise';
import { PencilSimpleIcon } from '@/components/ui/icons/pencil-simple';
import { WarningIcon } from '@/components/ui/icons/warning';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { toast } from '@/components/ui/toast';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { SaldoKurangRow } from '@/features/catat/catat-status';
import { newClientId } from '@/features/catat/client-id';
import { undoOrNotify } from '@/features/catat/saved-toast';
import type {
  AccountVM,
  CategoryVM,
  EntryVM,
  LedgerErrorCode,
  Ruang,
} from '@/features/ledger/types';
import { RUANG_LABEL } from '@/features/shell/hrefs';
import { DETAIL_TITLE_ID } from '@/features/transaksi/entry-detail-view';
import { VOIDED_COPY } from '@/features/transaksi/voided-banner';
import { restoreEntryAction, voidEntryAction } from '../_actions/entri';

/**
 * Aksi Detail nyata (pulau klien, dimuat malas lewat `detail-islands`). Sheet Ubah (`EditSheet` +
 * sumber nyata) dan dialog Batalkan dimuat saat pertama dipakai (pointer/fokus = muat lebih awal).
 */

const loadEdit = () => import('./detail-edit');
const EditSheetReal = lazy(() => loadEdit().then((m) => ({ default: m.EditSheetReal })));
const preloadEdit = () => {
  void loadEdit();
};

const loadVoid = () => import('@/features/transaksi/void-dialog-view');
const preloadVoid = () => {
  void loadVoid();
};

interface Failure {
  ok: false;
  error: { code: LedgerErrorCode };
}
const NETWORK: Failure = { ok: false, error: { code: 'network' } };

/** Galat batal (keputusan agen, menunggu pemilik): konflik versi memuat ulang Detail. */
function voidFailedText(code: LedgerErrorCode): string {
  if (code === 'conflict') return 'Transaksi ini baru saja diubah. Periksa lalu batalkan lagi.';
  if (code === 'network') return 'Belum bisa dibatalkan. Periksa koneksi lalu coba lagi.';
  return 'Belum bisa dibatalkan. Ada kendala di server.';
}

export interface DetailActionsProps {
  ruang: Ruang;
  entry: EntryVM;
  accounts: AccountVM[];
  categories: CategoryVM[];
  today: IsoDate;
  me: string;
  listHref: Route;
  editable: boolean;
  voidable: boolean;
}

export function DetailActions({
  ruang,
  entry,
  accounts,
  categories,
  today,
  me,
  listHref,
  editable,
  voidable,
}: DetailActionsProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const busy = useRef(false);
  const editMounted = useOpenedOnce(editing);
  const voidMounted = useOpenedOnce(confirming);
  const label = RUANG_LABEL[ruang];

  async function confirmVoid() {
    // Klik ganda: satu permintaan. Batal tidak pernah diulang otomatis (clientId per percobaan).
    if (busy.current) return;
    busy.current = true;
    setVoiding(true);
    let res: Awaited<ReturnType<typeof voidEntryAction>> | Failure;
    try {
      res = await voidEntryAction(ruang, {
        clientId: newClientId(),
        entryId: entry.id,
        expectedVersion: entry.version,
      });
    } catch {
      res = NETWORK;
    } finally {
      busy.current = false;
      setVoiding(false);
    }
    if (!res.ok) {
      if (res.error.code === 'conflict') router.refresh();
      toast({ message: voidFailedText(res.error.code), tone: 'info' });
      return;
    }
    const version = res.value.version;
    const { voidedToastVM } = await loadVoid();
    router.push(listHref);
    toast({
      message: voidedToastVM(label, entry),
      action: {
        label: 'Urungkan',
        onAction: () => {
          // Urungkan = pulihkan versi hasil batal; gagal (konflik, jaringan, lewat 90 hari) = toast.
          void undoOrNotify(
            async (v: number) => {
              try {
                const r = await restoreEntryAction(ruang, {
                  clientId: newClientId(),
                  entryId: entry.id,
                  expectedVersion: v,
                });
                return r.ok;
              } catch {
                return false;
              }
            },
            version,
            toast,
          );
        },
      },
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {editable ? (
        <Button
          variant="secondary"
          onPointerEnter={preloadEdit}
          onFocus={preloadEdit}
          onClick={() => {
            setEditing(true);
          }}
        >
          <PencilSimpleIcon size={18} weight="bold" />
          Ubah
        </Button>
      ) : null}
      {voidable ? (
        <Button
          variant="danger"
          aria-busy={voiding || undefined}
          aria-disabled={voiding || undefined}
          onPointerEnter={preloadVoid}
          onFocus={preloadVoid}
          onClick={() => {
            if (!voiding) setConfirming(true);
          }}
        >
          <ArrowCounterClockwiseIcon size={18} weight="bold" />
          Batalkan transaksi
        </Button>
      ) : null}
      {editable && editMounted ? (
        <Suspense fallback={null}>
          <EditSheetReal
            open={editing}
            onOpenChange={setEditing}
            ruang={ruang}
            entry={entry}
            accounts={accounts}
            categories={categories}
            today={today}
            me={me}
          />
        </Suspense>
      ) : null}
      {voidable && voidMounted ? (
        <Suspense fallback={null}>
          <VoidDialogDescribed
            entry={entry}
            open={confirming}
            onOpenChange={setConfirming}
            onConfirm={() => {
              void confirmVoid();
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

/** Dialog Batalkan dengan kalimat akibat dari `EntryVM` (salinan dialog tetap). */
const VoidDialogDescribed = lazy(() =>
  loadVoid().then((m) => ({
    default: function Described(props: {
      entry: EntryVM;
      open: boolean;
      onOpenChange: (open: boolean) => void;
      onConfirm: () => void;
    }) {
      return (
        <m.VoidDialogView
          open={props.open}
          onOpenChange={props.onOpenChange}
          onConfirm={props.onConfirm}
          description={m.voidSentenceVM(props.entry)}
        />
      );
    },
  })),
);

/** Saldo dompet utama sesudah entri batal dipulihkan (baris utama dipasang lagi). */
function restoredBalance(entry: EntryVM, account: AccountVM): number {
  const out =
    entry.kind === 'expense' ||
    entry.kind === 'transfer' ||
    ((entry.kind === 'space_transfer' || entry.kind === 'adjustment') && entry.direction === 'out');
  return account.balance + (out ? -entry.amount : entry.amount);
}

export interface RestoreActionProps {
  ruang: Ruang;
  entry: EntryVM;
  accounts: AccountVM[];
}

type RestoreState = 'idle' | 'busy' | 'saldo' | 'closed' | 'galat';

/**
 * `Pulihkan` di banner S6-D3. Satu clientId per sesi pulihkan ("Coba lagi" dan "Tetap pulihkan"
 * memakainya lagi). Sesudah berhasil: toast, Detail dimuat ulang ke keadaan hidup, fokus ke judul.
 */
export function RestoreAction({ ruang, entry, accounts }: RestoreActionProps) {
  const router = useRouter();
  const [clientId, setClientId] = useState(newClientId);
  const [state, setState] = useState<RestoreState>('idle');
  const [negative, setNegative] = useState(false);
  const busy = useRef(false);
  const noteId = useId();

  async function restore(allowNegative: boolean) {
    if (busy.current) return;
    busy.current = true;
    setState('busy');
    setNegative(allowNegative);
    let res: Awaited<ReturnType<typeof restoreEntryAction>> | Failure;
    try {
      res = await restoreEntryAction(ruang, {
        clientId,
        entryId: entry.id,
        expectedVersion: entry.version,
        allowNegative,
      });
    } catch {
      res = NETWORK;
    } finally {
      busy.current = false;
    }
    if (res.ok) {
      toast({ message: `Dipulihkan di ${RUANG_LABEL[ruang]} · ${formatRupiah(entry.amount)}` });
      // Banner hilang saat Detail dimuat ulang (refresh dari action): fokus ke judul, bukan <body>.
      setTimeout(() => {
        const title = document.getElementById(DETAIL_TITLE_ID);
        title?.setAttribute('tabindex', '-1');
        title?.focus();
      }, 0);
      return;
    }
    const code = res.error.code;
    if (code === 'saldo_negatif') setState('saldo');
    else if (code === 'restore_window_closed') setState('closed');
    else if (code === 'conflict') {
      // Entri berubah di tab/perangkat lain: muat ulang Detail; percobaan berikutnya sesi baru.
      setClientId(newClientId());
      setState('idle');
      router.refresh();
    } else setState('galat');
  }

  if (state === 'closed') {
    return (
      <p className="flex items-center gap-1.5 text-meta font-semibold text-warning">
        <WarningIcon size={16} weight="fill" className="shrink-0" />
        {VOIDED_COPY.closed}
      </p>
    );
  }

  const account = accounts.find((a) => a.id === entry.accountId);
  const saldoShown = state === 'saldo' || (state === 'busy' && negative);
  const note =
    saldoShown && account !== undefined ? (
      <SaldoKurangRow id={noteId}>
        {`Saldo ${account.name} tinggal ${formatRupiah(account.balance)}. Kalau dipulihkan, saldonya jadi ${formatRupiah(restoredBalance(entry, account))}.`}
      </SaldoKurangRow>
    ) : state === 'galat' ? (
      <p
        id={noteId}
        role="alert"
        className="flex items-start gap-1.5 text-meta font-semibold text-danger"
      >
        <WarningCircleIcon size={16} weight="fill" className="mt-px shrink-0" />
        <span className="min-w-0 text-pretty">
          Belum bisa dipulihkan. Periksa koneksi lalu coba lagi.
        </span>
      </p>
    ) : null;

  const saving = state === 'busy';
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-busy={saving || undefined}
        aria-disabled={saving || undefined}
        aria-describedby={note === null ? undefined : noteId}
        onClick={() => {
          if (!saving) void restore(state === 'saldo');
        }}
      >
        {state === 'saldo' ? 'Tetap pulihkan' : VOIDED_COPY.restore}
      </Button>
      {note === null ? null : <div className="basis-full">{note}</div>}
    </>
  );
}
