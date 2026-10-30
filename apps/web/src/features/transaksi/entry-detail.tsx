'use client';

import { ArrowLeftIcon, ProhibitIcon } from '@phosphor-icons/react';
import { entryTitle, signedAmount } from '@dompetku/demo-data';
import type { Entry } from '@dompetku/demo-data';
import { dayLabel, formatRupiah } from '@dompetku/domain';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MoneyText } from '@/components/ui/money-text';
import { focusRing } from '@/components/ui/styles';
import { toast } from '@/components/ui/toast';
import { RUANG_NAME, type TransaksiContext } from './context';
import { entryKindLabel } from './entry-row';
import { accountName } from './filters';
import { VoidDialog } from './void-dialog';

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

export function EntryDetail({ entry, ...ctx }: TransaksiContext & { entry: Entry }) {
  const { state, store, today, listHref } = ctx;
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const { value, kind } = signedAmount(entry);
  const voided = entry.voidedAt !== undefined;
  const author = state.members.find((m) => m.id === entry.createdBy);
  const you = state.members[0];
  const by = author === undefined || author.id === you?.id ? 'kamu' : author.name;
  const wallet =
    entry.kind === 'transfer' && entry.counterAccountId !== undefined
      ? `${accountName(state, entry.accountId)} → ${accountName(state, entry.counterAccountId)}`
      : accountName(state, entry.accountId);
  const soon = () => {
    toast({ message: 'Segera di M1' });
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
    <article>
      <Link
        href={listHref}
        className={`inline-flex min-h-11 items-center gap-2 rounded-field text-base text-text ${focusRing}`}
      >
        <ArrowLeftIcon size={20} aria-hidden="true" />
        Kembali ke daftar
      </Link>
      <h1 className="mt-2 text-xl font-semibold break-words text-text">
        {entryTitle(state, entry)}
      </h1>
      <p className="mt-1">
        <MoneyText value={value} kind={kind} size="hero" />
      </p>
      <p className="mt-1 text-base text-text-muted">
        {dayLabel(entry.occurredOn, today)} · dicatat oleh {by}
      </p>
      {voided ? (
        <p className="mt-4 flex items-start gap-2 text-base text-danger">
          <ProhibitIcon size={20} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>Transaksi ini sudah dibatalkan.</span>
        </p>
      ) : null}
      <dl className="mt-6 border-t border-hairline text-base">
        <div className="flex justify-between gap-3 border-b border-hairline py-2">
          <dt className="text-text-muted">Kategori</dt>
          <dd className="min-w-0 text-right break-words text-text">
            {entryKindLabel(state, entry)}
          </dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-hairline py-2">
          <dt className="text-text-muted">Dompet</dt>
          <dd className="min-w-0 text-right break-words text-text">{wallet}</dd>
        </div>
        {entry.sharedNote === undefined ? null : (
          <div className="flex justify-between gap-3 border-b border-hairline py-2">
            <dt className="text-text-muted">Catatan</dt>
            <dd className="min-w-0 text-right break-words text-text">{entry.sharedNote}</dd>
          </div>
        )}
      </dl>
      {voided ? null : (
        <div className="mt-6 flex flex-col gap-2">
          <Button variant="secondary" onClick={soon}>
            Ubah
          </Button>
          <Button variant="secondary" onClick={soon}>
            Pindahkan ke ruang lain
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Batalkan
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
