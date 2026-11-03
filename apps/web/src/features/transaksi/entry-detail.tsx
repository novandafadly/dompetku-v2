'use client';

import { entryKindLabel, entryTitle, signedAmount } from '@dompetku/demo-data';
import type { DemoState, Entry } from '@dompetku/demo-data';
import { formatRupiah } from '@dompetku/domain';
import { useRouter } from 'next/navigation';
import { lazy, Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowCounterClockwiseIcon } from '@/components/ui/icons/arrow-counter-clockwise';
import { ArrowsLeftRightIcon } from '@/components/ui/icons/arrows-left-right';
import { PencilSimpleIcon } from '@/components/ui/icons/pencil-simple';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { toast } from '@/components/ui/toast';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { RUANG_NAME, type TransaksiContext } from './context';
import type { EntryVM } from '@/features/ledger/types';
import { EntryDetailView } from './entry-detail-view';
import { accountName } from './filters';

// Dialog Batalkan (Radix AlertDialog) dimuat saat pertama dibuka, bukan bagian JS muat awal Detail.
const loadVoidDialog = () => import('./void-dialog');
const VoidDialog = lazy(() => loadVoidDialog().then((m) => ({ default: m.VoidDialog })));
const preloadVoidDialog = () => {
  void loadVoidDialog();
};

/** Pola toast Catat: "Dibatalkan di Pribadi · Rp 35.000 dari BCA". */
function voidedMessage(state: TransaksiContext['state'], e: Entry): string {
  const name = (id: string | undefined) => accountName(state, id ?? '');
  const head = `Dibatalkan di ${RUANG_NAME[e.ruang]} · ${formatRupiah(e.amount)}`;
  switch (e.kind) {
    case 'income':
      return `${head} ke ${name(e.accountId)}`;
    case 'transfer':
      return `${head} dari ${name(e.accountId)} ke ${name(e.counterAccountId)}`;
    default:
      return `${head} dari ${name(e.accountId)}`;
  }
}

/**
 * Entri demo → `EntryVM` untuk Detail. Sengaja tidak memakai `entryToVM` (demo-vm.ts): modul yang
 * dipakai dua rute tidak lagi disatukan ke chunk page Transaksi, dan itu menambah JS muat awal
 * Transaksi (ADR 0002, sisa anggaran < 1 kB). Isinya sebatas field yang dibaca `EntryDetailView` (ikon, dompet, tanggal, catatan); judul, label
 * kategori, dan nominal dari selector demo.
 */
function detailVM(state: DemoState, e: Entry): EntryVM {
  const name = (id: string | undefined) => accountName(state, id ?? '');
  const vm: EntryVM = {
    id: e.id,
    version: 1,
    kind: e.kind,
    occurredOn: e.occurredOn,
    createdAt: e.createdAt,
    createdBy: { id: e.createdBy, name: '', initial: '' },
    accountId: e.accountId,
    accountName: name(e.accountId),
    amount: e.amount,
  };
  const cat = state.categories.find((c) => c.id === e.categoryId)?.name;
  if (cat !== undefined) vm.categoryName = cat;
  if (e.counterAccountId !== undefined) vm.counterAccountName = name(e.counterAccountId);
  if (e.sharedNote !== undefined) vm.sharedNote = e.sharedNote;
  return vm;
}

/** Pembungkus demo: entri demo → `EntryVM` → `EntryDetailView` (markup sama dengan mode nyata). */
export function EntryDetail({ entry, ...ctx }: TransaksiContext & { entry: Entry }) {
  const { state, store, today, listHref } = ctx;
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const dialogMounted = useOpenedOnce(confirming);
  const voided = entry.voidedAt !== undefined;
  const author = state.members.find((m) => m.id === entry.createdBy);
  const you = state.members[0];
  const by = author === undefined || author.id === you?.id ? 'kamu' : author.name;
  const soon = () => {
    toast({ message: 'Segera di M1', tone: 'info' });
  };

  function confirmVoid() {
    store.voidEntry(entry.id);
    router.push(listHref);
    toast({
      message: voidedMessage(state, entry),
      action: {
        label: 'Urungkan',
        onAction: () => {
          store.restoreEntry(entry.id);
        },
      },
    });
  }

  return (
    <>
      <EntryDetailView
        entry={detailVM(state, entry)}
        title={entryTitle(state, entry)}
        category={entryKindLabel(state, entry)}
        amount={signedAmount(entry)}
        ruang={entry.ruang}
        by={by}
        today={today}
        listHref={listHref}
        heroNote={
          voided ? (
            <p className="flex items-start gap-2 rounded-lg bg-danger-tint px-3 py-2.5 text-label font-bold text-danger">
              <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" />
              <span>Transaksi ini sudah dibatalkan.</span>
            </p>
          ) : null
        }
        actions={
          voided ? null : (
            <div className="flex flex-col gap-2">
              <Button variant="secondary" onClick={soon}>
                <PencilSimpleIcon size={18} weight="bold" />
                Ubah
              </Button>
              <Button variant="secondary" onClick={soon}>
                <ArrowsLeftRightIcon size={18} weight="bold" />
                Pindahkan ke ruang lain
              </Button>
              <Button
                variant="danger"
                onPointerEnter={preloadVoidDialog}
                onFocus={preloadVoidDialog}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                <ArrowCounterClockwiseIcon size={18} weight="bold" />
                Batalkan transaksi
              </Button>
            </div>
          )
        }
      />
      {dialogMounted ? (
        <Suspense fallback={null}>
          <VoidDialog
            state={state}
            entry={entry}
            open={confirming}
            onOpenChange={setConfirming}
            onConfirm={confirmVoid}
          />
        </Suspense>
      ) : null}
    </>
  );
}
