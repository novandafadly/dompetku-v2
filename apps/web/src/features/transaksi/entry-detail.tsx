'use client';

import { entryCategoryName, entryKindLabel, entryTitle, signedAmount } from '@dompetku/demo-data';
import type { Entry } from '@dompetku/demo-data';
import { detailDateLabel, formatRupiah } from '@dompetku/domain';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/ui/category-icon';
import { ArrowCounterClockwiseIcon } from '@/components/ui/icons/arrow-counter-clockwise';
import { ArrowsLeftRightIcon } from '@/components/ui/icons/arrows-left-right';
import { PencilSimpleIcon } from '@/components/ui/icons/pencil-simple';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { MoneyText } from '@/components/ui/money-text';
import { SpaceTag } from '@/components/ui/space-tag';
import { card, heroCard, rowDivider, tile } from '@/components/ui/styles';
import { toast } from '@/components/ui/toast';
import { RUANG_NAME, type TransaksiContext } from './context';
import { entryWallet } from './entry-row';
import { accountName } from './filters';
import { VoidDialog } from './void-dialog';

const KIND_NAME: Record<Entry['kind'], string> = {
  expense: 'Pengeluaran',
  income: 'Pemasukan',
  transfer: 'Pindah dompet',
  opening_balance: 'Saldo awal',
  space_transfer: 'Antar ruang',
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

function DetailRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className={`flex min-h-13 items-center justify-between gap-3 ${rowDivider}`}>
      <dt className="text-body font-medium text-text-muted">{term}</dt>
      <dd className="min-w-0 text-right text-body font-semibold break-words text-text">
        {children}
      </dd>
    </div>
  );
}

export function EntryDetail({ entry, ...ctx }: TransaksiContext & { entry: Entry }) {
  const { state, store, today, listHref } = ctx;
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const { value, kind } = signedAmount(entry);
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
    <article className="flex flex-col gap-3 tablet:gap-4 laptop:max-w-180 laptop:pt-6">
      <BackLink href={listHref}>Transaksi</BackLink>
      <section className={`flex flex-col gap-3 p-4 ${heroCard}`}>
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className={`size-12 ${tile}`}>
            <CategoryIcon name={entryCategoryName(state, entry)} kind={entry.kind} size={24} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="text-subheading font-bold break-words text-text">
              {entryTitle(state, entry)}
            </h1>
            <p className="text-label font-medium text-text-muted">{KIND_NAME[entry.kind]}</p>
          </div>
        </div>
        <p>
          <MoneyText value={value} kind={kind} size="amount" />
        </p>
        {voided ? (
          <p className="flex items-start gap-2 rounded-lg bg-danger-tint px-3 py-2.5 text-label font-bold text-danger">
            <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" />
            <span>Transaksi ini sudah dibatalkan.</span>
          </p>
        ) : null}
      </section>
      <dl className={`px-4 ${card}`}>
        <DetailRow term="Kategori">{entryKindLabel(state, entry)}</DetailRow>
        <DetailRow term="Dompet">{entryWallet(state, entry)}</DetailRow>
        <DetailRow term="Tanggal">{detailDateLabel(entry.occurredOn, today)}</DetailRow>
        <DetailRow term="Ruang">
          <SpaceTag space={entry.ruang} />
        </DetailRow>
        <DetailRow term="Dicatat oleh">{by}</DetailRow>
        {entry.sharedNote === undefined ? null : (
          <DetailRow term="Catatan">{entry.sharedNote}</DetailRow>
        )}
      </dl>
      {voided ? null : (
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
            onClick={() => {
              setConfirming(true);
            }}
          >
            <ArrowCounterClockwiseIcon size={18} weight="bold" />
            Batalkan transaksi
          </Button>
        </div>
      )}
      <VoidDialog
        state={state}
        entry={entry}
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={confirmVoid}
      />
    </article>
  );
}
