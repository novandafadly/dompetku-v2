'use client';

import type { IsoDate } from '@dompetku/domain';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { lazy, Suspense, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowCounterClockwiseIcon } from '@/components/ui/icons/arrow-counter-clockwise';
import { ArrowsLeftRightIcon } from '@/components/ui/icons/arrows-left-right';
import { HandCoinsIcon } from '@/components/ui/icons/hand-coins';
import { PencilSimpleIcon } from '@/components/ui/icons/pencil-simple';
import { toast } from '@/components/ui/toast';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { newClientId } from '@/features/catat/client-id';
import { undoVoidOnce } from '@/features/catat/saved-toast';
import type {
  AccountVM,
  CategoryVM,
  EntryVM,
  LedgerErrorCode,
  Ruang,
} from '@/features/ledger/types';
import { buildHref, RUANG_LABEL } from '@/features/shell/hrefs';
import { DETAIL_TITLE_ID } from '@/features/transaksi/entry-detail-view';
import { restoreEntryAction, voidEntryAction } from '../_actions/entri';
import { RestoreControl } from '../restore-control';
import { focusHeadingAt, focusTitle as focusTitleById } from './focus-title';

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

const loadMove = () => import('./detail-move');
const MoveSheetReal = lazy(() => loadMove().then((m) => ({ default: m.MoveSheetReal })));
const preloadMove = () => {
  void loadMove();
};

// Sheet `Catat reimburse` dan dialog `Tidak diganti` satu chunk (hanya talangan yang memakainya).
const loadReimburse = () => import('./detail-reimburse');
const ReimburseSheetReal = lazy(() =>
  loadReimburse().then((m) => ({ default: m.ReimburseSheetReal })),
);
const NotReimbursedDialogReal = lazy(() =>
  loadReimburse().then((m) => ({ default: m.NotReimbursedDialogReal })),
);
const preloadReimburse = () => {
  void loadReimburse();
};

/** Sesudah halaman dimuat ulang (banner/status berubah): fokus ke judul Detail. */
const focusTitle = () => {
  focusTitleById(DETAIL_TITLE_ID);
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
  /** Ruang tujuan "Pindahkan ke ruang lain" (S7-D2); `null` = tidak ditawarkan. */
  moveTo: Ruang | null;
  /** Talangan yang masih menunggu diganti (S7-D3); `null` = tidak ditawarkan. */
  reimbursable: { remaining: number } | null;
  /** `Tidak diganti` hanya bila belum ada reimburse hidup (DB menolak sebaliknya). */
  canGiveUp: boolean;
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
  moveTo,
  reimbursable,
  canGiveUp,
}: DetailActionsProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [moving, setMoving] = useState(false);
  const [reimbursing, setReimbursing] = useState(false);
  const [giveUp, setGiveUp] = useState(false);
  const busy = useRef(false);
  const editMounted = useOpenedOnce(editing);
  const voidMounted = useOpenedOnce(confirming);
  const moveMounted = useOpenedOnce(moving);
  const reimburseMounted = useOpenedOnce(reimbursing);
  const giveUpMounted = useOpenedOnce(giveUp);
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
    // Satu clientId per toast: klik berulang dan percobaan ulang = permintaan pulihkan yang sama.
    const undo = undoVoidOnce((req) => restoreEntryAction(ruang, req), entry.id, version, toast);
    toast({
      message: voidedToastVM(label, entry),
      action: {
        label: 'Urungkan',
        onAction: () => {
          // Urungkan = pulihkan versi hasil batal; gagal (konflik, jaringan, lewat 90 hari) = toast.
          void undo();
        },
      },
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {reimbursable !== null ? (
        <>
          <Button
            onPointerEnter={preloadReimburse}
            onFocus={preloadReimburse}
            onClick={() => {
              setReimbursing(true);
            }}
          >
            <HandCoinsIcon size={18} weight="bold" />
            Catat reimburse
          </Button>
          {canGiveUp ? (
            <Button
              variant="secondary"
              onPointerEnter={preloadReimburse}
              onFocus={preloadReimburse}
              onClick={() => {
                setGiveUp(true);
              }}
            >
              Tidak diganti
            </Button>
          ) : null}
        </>
      ) : null}
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
      {moveTo !== null ? (
        <Button
          variant="secondary"
          onPointerEnter={preloadMove}
          onFocus={preloadMove}
          onClick={() => {
            setMoving(true);
          }}
        >
          <ArrowsLeftRightIcon size={18} weight="bold" />
          {`Pindahkan ke ${RUANG_LABEL[moveTo]}`}
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
      {moveTo !== null && moveMounted ? (
        <Suspense fallback={null}>
          <MoveSheetReal
            open={moving}
            onOpenChange={setMoving}
            ruang={ruang}
            toRuang={moveTo}
            entry={entry}
            onMoved={() => {
              // Id entri baru tidak dikembalikan (R24): ke daftar Transaksi ruang tujuan, fokus ke
              // judulnya (sheet dan tombol asal ikut tercabut; tanpa ini fokus jatuh ke <body>).
              const href = buildHref(moveTo, 'transaksi', '');
              router.push(href);
              focusHeadingAt(href);
            }}
            onConflict={() => {
              router.refresh();
            }}
          />
        </Suspense>
      ) : null}
      {reimbursable !== null && reimburseMounted ? (
        <Suspense fallback={null}>
          <ReimburseSheetReal
            open={reimbursing}
            onOpenChange={setReimbursing}
            ruang={ruang}
            entry={entry}
            remaining={reimbursable.remaining}
            accounts={accounts}
            today={today}
            onSaved={focusTitle}
          />
        </Suspense>
      ) : null}
      {reimbursable !== null && canGiveUp && giveUpMounted ? (
        <Suspense fallback={null}>
          <NotReimbursedDialogReal
            open={giveUp}
            onOpenChange={setGiveUp}
            ruang={ruang}
            entry={entry}
            onDone={focusTitle}
            onConflict={() => {
              router.refresh();
            }}
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
          {...(props.entry.kind === 'space_transfer'
            ? { title: 'Batalkan transfer antar ruang?', confirmLabel: 'Batalkan transfer' }
            : {})}
        />
      );
    },
  })),
);

export interface RestoreActionProps {
  ruang: Ruang;
  entry: EntryVM;
  accounts: AccountVM[];
}

/**
 * `Pulihkan` di banner S6-D3: alur bersama dengan Sampah (`RestoreControl`). Sesudah berhasil
 * Detail dimuat ulang ke keadaan hidup (refresh dari action) dan fokus pindah ke judul.
 */
export function RestoreAction({ ruang, entry, accounts }: RestoreActionProps) {
  const router = useRouter();
  const account = accounts.find((a) => a.id === entry.accountId);
  return (
    <RestoreControl
      ruang={ruang}
      entry={entry}
      account={account}
      restore={(req) => restoreEntryAction(ruang, req)}
      // Banner hilang saat Detail dimuat ulang: fokus ke judul, bukan <body>.
      onRestored={focusTitle}
      onConflict={() => {
        router.refresh();
      }}
    />
  );
}
