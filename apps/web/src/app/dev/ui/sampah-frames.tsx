'use client';

import type { Route } from 'next';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowClockwiseIcon } from '@/components/ui/icons/arrow-clockwise';
import type { AccountVM, EntryVM, TrashVM } from '@/features/ledger/types';
import { TrashFailed, TrashLoading } from '@/features/sampah/trash-states';
import type { RestoreFn } from '@/app/[ruang]/restore-control';
import { TRASH_WIDTH, TrashHeader, TrashList } from '@/app/[ruang]/sampah/trash-parts';

/**
 * Bingkai S6-S1 (docs/design/s6-bingkai.md) dengan komponen yang sama dengan Sampah nyata, di atas
 * VM statis dan `restore` palsu: daftar (nominal panjang, pemasukan, pindah dompet), kosong,
 * memuat, gagal muat, lewat 90 hari dan saldo tidak cukup (keduanya muncul sesudah `Pulihkan`
 * ditekan). Untuk tinjauan desain 320/390/1280, terang dan gelap.
 */

const TODAY = '2026-10-31';
const backHref = '/pribadi/transaksi' as Route;
const by = { id: 'u-n', name: 'Novanda', initial: 'N' };

const entry = (id: string, over: Partial<EntryVM>): TrashVM => ({
  entry: {
    id,
    version: 3,
    kind: 'expense',
    occurredOn: '2026-10-28',
    createdAt: '2026-10-28T08:10:00+07:00',
    createdBy: by,
    accountId: 'a-1',
    accountName: 'BCA',
    amount: 45_000,
    categoryName: 'Makan',
    voidedAt: '2026-10-31T09:00:00+07:00',
    ...over,
  },
  purgeAfter: '2027-01-29T09:00:00+07:00',
});

const LONG = entry('s-1', {
  accountName: 'BCA Operasional Rumah Tangga',
  amount: 12_345_678_900,
  categoryName: 'Belanja dapur',
  description: 'Belanja bulanan dengan deskripsi yang sangat panjang sekali',
});
const INCOME = entry('s-2', {
  kind: 'income',
  amount: 8_500_000,
  categoryName: 'Gaji',
  voidedAt: '2026-10-30T09:00:00+07:00',
});
const TRANSFER = entry('s-3', {
  kind: 'transfer',
  amount: 500_000,
  counterAccountId: 'a-2',
  counterAccountName: 'Tunai',
  voidedAt: '2026-08-12T09:00:00+07:00',
});
const ONE = entry('s-4', { description: 'Nasi padang' });

const ACCOUNTS: AccountVM[] = [
  {
    id: 'a-1',
    name: 'BCA',
    pocket: 'operasional',
    walletType: 'bank',
    openedOn: '2026-09-01',
    archived: false,
    balance: 20_000,
  },
];

const ok: RestoreFn = () => Promise.resolve({ ok: true, value: { version: 4 } });
const closed: RestoreFn = () =>
  Promise.resolve({ ok: false, error: { code: 'restore_window_closed' } });
const saldo: RestoreFn = () => Promise.resolve({ ok: false, error: { code: 'saldo_negatif' } });

function Frame({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div data-frame={id} className="flex flex-col gap-3">
      <h3 className="text-label font-bold text-text-soft">{title}</h3>
      {children}
    </div>
  );
}

function List({ items, restore }: { items: TrashVM[]; restore: RestoreFn }) {
  return (
    <TrashList ruang="pribadi" today={TODAY} items={items} accounts={ACCOUNTS} restore={restore} />
  );
}

export function SampahFrames() {
  return (
    <div className="flex flex-col gap-6">
      <Frame id="s-daftar" title="Daftar · nominal panjang, pemasukan, pindah dompet">
        <section className={TRASH_WIDTH}>
          <TrashHeader ruang="pribadi" backHref={backHref} />
          <List items={[LONG, INCOME, TRANSFER]} restore={ok} />
        </section>
      </Frame>
      <Frame id="s-kosong" title="Kosong (Bersama)">
        <section className={TRASH_WIDTH}>
          <TrashHeader ruang="bersama" backHref={backHref} />
          <TrashList ruang="bersama" today={TODAY} items={[]} accounts={[]} restore={ok} />
        </section>
      </Frame>
      <Frame id="s-memuat" title="Memuat">
        <TrashLoading />
      </Frame>
      <Frame id="s-gagal" title="Gagal muat">
        <TrashFailed
          actions={
            <Button>
              <ArrowClockwiseIcon size={18} weight="bold" />
              Coba lagi
            </Button>
          }
        />
      </Frame>
      <Frame id="s-lewat" title="Lewat 90 hari saat Pulihkan ditekan (tekan Pulihkan)">
        <List items={[ONE]} restore={closed} />
      </Frame>
      <Frame id="s-saldo" title="Saldo tidak cukup (tekan Pulihkan)">
        <List items={[ONE]} restore={saldo} />
      </Frame>
    </div>
  );
}
