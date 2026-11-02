'use client';

import type { ReactNode } from 'react';
import { TransaksiFailed, TransaksiReal } from '@/app/[ruang]/_real/transaksi';
import type { EntryVM, MonthSummaryVM } from '@/features/ledger/types';
import { CatatProvider } from '@/features/shell/catat';

/**
 * Keadaan Transaksi mode nyata (komponen yang sama dengan page nyata) di atas VM statis: tanpa
 * store demo, tanpa server. Untuk tinjauan desain 320/390/1280, terang dan gelap: daftar dengan
 * nominal panjang, kosong pertama kali, kosong karena bulan, gagal muat.
 */

const TODAY = '2026-10-22';
const noop = () => undefined;
const ZERO: MonthSummaryVM = { pemasukan: 0, pengeluaran: 0, selisih: 0, transfer: 0 };

const by = { id: 'u-n', name: 'Novanda', initial: 'N' };
const ENTRIES: EntryVM[] = [
  {
    id: 'g-1',
    version: 1,
    kind: 'expense',
    occurredOn: '2026-10-22',
    createdAt: '2026-10-22T12:10:00+07:00',
    createdBy: by,
    accountId: 'a-1',
    accountName: 'BCA Operasional Rumah Tangga',
    amount: 12_345_678_900,
    categoryName: 'Belanja dapur',
    description: 'Belanja bulanan dengan deskripsi yang sangat panjang sekali',
  },
  {
    id: 'g-2',
    version: 1,
    kind: 'income',
    occurredOn: '2026-10-21',
    createdAt: '2026-10-21T09:00:00+07:00',
    createdBy: by,
    accountId: 'a-1',
    accountName: 'BCA',
    amount: 8_500_000,
    categoryName: 'Gaji',
  },
  {
    id: 'g-3',
    version: 1,
    kind: 'transfer',
    occurredOn: '2026-10-21',
    createdAt: '2026-10-21T08:00:00+07:00',
    createdBy: by,
    accountId: 'a-1',
    accountName: 'BCA',
    counterAccountId: 'a-2',
    counterAccountName: 'Tunai',
    amount: 500_000,
  },
];

function Frame({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div data-frame={id} className="flex flex-col gap-3">
      <h3 className="text-label font-bold text-text-soft">{title}</h3>
      {children}
    </div>
  );
}

export function TransaksiFrames() {
  return (
    <CatatProvider renderSheet={() => null} preload={noop}>
      <div className="flex flex-col gap-6">
        <Frame id="t-daftar" title="Daftar nyata · nominal panjang, transfer, ringkasan">
          <TransaksiReal
            ruang="pribadi"
            today={TODAY}
            month="2026-10"
            minMonth="2026-09"
            query=""
            data={{
              entries: ENTRIES,
              summary: {
                pemasukan: 8_500_000,
                pengeluaran: 12_345_678_900,
                selisih: 8_500_000 - 12_345_678_900,
                transfer: 500_000,
              },
              hasAny: true,
            }}
          />
        </Frame>
        <Frame id="t-kosong-pertama" title="Kosong pertama kali (Bersama)">
          <TransaksiReal
            ruang="bersama"
            today={TODAY}
            month="2026-10"
            minMonth="2026-10"
            query=""
            data={{ entries: [], summary: ZERO, hasAny: false }}
          />
        </Frame>
        <Frame id="t-kosong-bulan" title="Kosong karena bulan (September)">
          <TransaksiReal
            ruang="pribadi"
            today={TODAY}
            month="2026-09"
            minMonth="2026-08"
            query=""
            data={{ entries: [], summary: ZERO, hasAny: true }}
          />
        </Frame>
        <Frame id="t-gagal" title="Gagal muat">
          <TransaksiFailed />
        </Frame>
      </div>
    </CatatProvider>
  );
}
