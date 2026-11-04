'use client';

import type { Route } from 'next';
import { useState, type ReactNode } from 'react';
import { DetailReal } from '@/app/[ruang]/_real/detail';
import { Button } from '@/components/ui/button';
import { WarningIcon } from '@/components/ui/icons/warning';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { SaldoKurangRow } from '@/features/catat/catat-status';
import { EditSheet, type EditSource } from '@/features/catat/edit-sheet';
import type {
  AccountVM,
  CategoryVM,
  EntryVM,
  HistoryVM,
  TalanganVM,
} from '@/features/ledger/types';
import { CatatProvider } from '@/features/shell/catat';
import { VoidDialogView, voidSentenceVM } from '@/features/transaksi/void-dialog-view';
import { VOIDED_COPY, VoidedBanner } from '@/features/transaksi/voided-banner';

/**
 * Bingkai S6-D1…D3 (docs/design/s6-bingkai.md) dengan komponen yang sama dengan Detail nyata, di
 * atas VM statis dan sumber Ubah palsu: tanpa store demo, tanpa server. Aksi pulau (Batalkan,
 * Pulihkan) memanggil Server Action yang menolak di prototipe, jadi menampilkan keadaan galatnya.
 */

const TODAY = '2026-10-31';
const ME = 'u-n';
const noop = () => undefined;

const ACCOUNTS: AccountVM[] = [
  {
    id: 'a-1',
    name: 'BCA Operasional Rumah Tangga',
    pocket: 'operasional',
    walletType: 'bank',
    openedOn: '2026-09-01',
    archived: false,
    balance: 13_000_000_000,
  },
  {
    id: 'a-2',
    name: 'Tunai',
    pocket: 'operasional',
    walletType: 'cash',
    openedOn: '2026-09-01',
    archived: false,
    balance: 20_000,
  },
];

const cat = (id: string, name: string): CategoryVM => ({
  id,
  parentId: null,
  name,
  type: 'expense',
  icon: 'Tag',
  archived: false,
});

const CATEGORIES: CategoryVM[] = [
  cat('c-1', 'Belanja dapur'),
  cat('c-2', 'Makan'),
  cat('c-3', 'Transportasi'),
  cat('c-4', 'Kopi & Camilan'),
  cat('c-5', 'Rumah Tangga'),
  cat('c-6', 'Hiburan'),
  cat('c-7', 'Kesehatan'),
];

const LIVE: EntryVM = {
  id: 'g-detail',
  version: 2,
  kind: 'expense',
  occurredOn: '2026-10-30',
  createdAt: '2026-10-30T08:10:00+07:00',
  createdBy: { id: ME, name: 'Novanda', initial: 'N' },
  accountId: 'a-1',
  accountName: 'BCA Operasional Rumah Tangga',
  amount: 12_345_678_900,
  categoryId: 'c-1',
  categoryName: 'Belanja dapur',
  description: 'Belanja bulanan dengan deskripsi yang sangat panjang sekali',
};

const LATEST: EntryVM = {
  ...LIVE,
  version: 3,
  amount: 45_000,
  accountId: 'a-2',
  accountName: 'Tunai',
  description: 'Belanja bulanan',
};

const HISTORY: HistoryVM[] = [
  {
    version: 3,
    op: 'update',
    at: '2026-10-31T11:58:00+07:00',
    by: { name: 'Farida', initial: 'F' },
    changedBy: 'u-f',
    amount: 45_000,
  },
];

const VOIDED: EntryVM = { ...LIVE, version: 3, voidedAt: '2026-10-31T09:00:00+07:00' };

const LABELS = {
  title: LIVE.description ?? '',
  category: 'Belanja dapur',
  amount: { value: -LIVE.amount, kind: 'expense' as const },
};

const listHref = '/pribadi/transaksi' as Route;

// S7: kaki Bersama transfer antar ruang (dompet Bersama saja), talangan, dan entri yang dipindah.
const KAKI_BERSAMA: EntryVM = {
  id: 'g-kaki',
  version: 1,
  kind: 'space_transfer',
  spaceKind: 'shared',
  direction: 'in',
  occurredOn: '2026-10-30',
  createdAt: '2026-10-30T08:10:00+07:00',
  createdBy: { id: 'u-n', name: 'Novanda', initial: 'N' },
  accountId: 'a-2',
  accountName: 'Kas Bersama',
  amount: 1_250_000,
  sharedNote: 'Setoran Oktober',
};
const TALANGAN_ENTRY: EntryVM = { ...LIVE, id: 'g-tal', reimbursable: true, amount: 500_000 };
const SEBAGIAN: TalanganVM = {
  items: [{ id: 'g-r1', occurredOn: '2026-10-31', amount: 300_000 }],
  reimbursed: 300_000,
  remaining: 200_000,
};

type SheetFrame = 'd1' | 'd2' | 'saldo' | 'galat';

function fakeSource(frame: SheetFrame): EditSource {
  let calls = 0;
  return {
    update: () => {
      calls += 1;
      if (calls === 1 && frame === 'd2') {
        return Promise.resolve({ ok: false, error: { code: 'conflict' } });
      }
      if (calls === 1 && frame === 'saldo') {
        return Promise.resolve({ ok: false, error: { code: 'saldo_negatif' } });
      }
      if (calls === 1 && frame === 'galat') {
        return Promise.resolve({ ok: false, error: { code: 'network' } });
      }
      return Promise.resolve({ ok: true, value: { entryId: LIVE.id, version: 4 } });
    },
    reload: () => Promise.resolve({ ok: true, value: { entry: LATEST, history: HISTORY } }),
  };
}

const SHEETS: { id: SheetFrame; label: string }[] = [
  { id: 'd1', label: 'S6-D1 Sheet Ubah' },
  { id: 'd2', label: 'S6-D2 Konflik versi' },
  { id: 'saldo', label: 'S6-D1 Saldo tidak cukup' },
  { id: 'galat', label: 'S6-D1 Galat simpan' },
];

function Frame({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div data-frame={id} className="flex flex-col gap-3">
      <h3 className="text-label font-bold text-text-soft">{title}</h3>
      {children}
    </div>
  );
}

export function DetailFrames() {
  const [sheet, setSheet] = useState<SheetFrame | null>(null);
  const [dialog, setDialog] = useState(false);
  const data = { history: HISTORY, accounts: ACCOUNTS, categories: CATEGORIES };
  return (
    <CatatProvider renderSheet={() => null} preload={noop}>
      <div className="flex flex-col gap-6">
        <p className="text-meta text-text-muted">
          Buka sheet, ubah nominal (Saldo tidak cukup: lebih dari Rp 70.000 di Tunai), lalu Simpan
          perubahan.
        </p>
        <div className="flex flex-wrap gap-2">
          {SHEETS.map((s) => (
            <Button
              key={s.id}
              variant="secondary"
              size="sm"
              onClick={() => {
                setSheet(s.id);
              }}
            >
              {s.label}
            </Button>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDialog(true);
            }}
          >
            Dialog Batalkan
          </Button>
        </div>
        <Frame id="d1-detail" title="S6-D1 Detail hidup (Ubah, Batalkan; tanpa Pindahkan)">
          <DetailReal
            ruang="pribadi"
            today={TODAY}
            me={ME}
            listHref={listHref}
            data={{ entry: LIVE, ...data, restoreClosed: false, spaceCount: 1, talangan: null }}
            labels={LABELS}
          />
        </Frame>
        <Frame id="d3" title="S6-D3 Transaksi dibatalkan (Pulihkan)">
          <DetailReal
            ruang="pribadi"
            today={TODAY}
            me={ME}
            listHref={listHref}
            data={{ entry: VOIDED, ...data, restoreClosed: false, spaceCount: 1, talangan: null }}
            labels={LABELS}
          />
        </Frame>
        <Frame id="s7-d1" title="S7-D1 Detail kaki Bersama (bukan pencatat)">
          <DetailReal
            ruang="bersama"
            today={TODAY}
            me="u-f"
            listHref={'/bersama/transaksi' as Route}
            data={{
              entry: KAKI_BERSAMA,
              history: [],
              accounts: ACCOUNTS,
              categories: [],
              restoreClosed: false,
              spaceCount: 2,
              talangan: null,
            }}
            labels={{
              title: 'Setoran dari Novanda',
              category: 'Antar ruang',
              amount: { value: KAKI_BERSAMA.amount, kind: 'neutral' },
            }}
          />
        </Frame>
        <Frame id="s7-d2" title="S7-D2 Entri asal yang sudah dipindah">
          <DetailReal
            ruang="pribadi"
            today={TODAY}
            me={ME}
            listHref={listHref}
            data={{
              entry: { ...VOIDED, movedAt: VOIDED.voidedAt ?? '' },
              ...data,
              restoreClosed: false,
              spaceCount: 2,
              talangan: null,
            }}
            labels={LABELS}
          />
        </Frame>
        <Frame id="s7-d3" title="S7-D3 Detail talangan sebagian diganti">
          <DetailReal
            ruang="pribadi"
            today={TODAY}
            me={ME}
            listHref={listHref}
            data={{
              entry: TALANGAN_ENTRY,
              ...data,
              restoreClosed: false,
              spaceCount: 2,
              talangan: SEBAGIAN,
            }}
            labels={{ ...LABELS, amount: { value: -500_000, kind: 'expense' } }}
          />
        </Frame>
        <Frame id="d3-keadaan" title="S6-D3 banner: lewat 90 hari, saldo kurang, galat">
          <VoidedBanner>
            <p className="flex items-center gap-1.5 text-meta font-semibold text-warning">
              <WarningIcon size={16} weight="fill" className="shrink-0" />
              {VOIDED_COPY.closed}
            </p>
          </VoidedBanner>
          <VoidedBanner>
            <Button variant="secondary" size="sm" aria-describedby="galeri-d3-saldo">
              Tetap pulihkan
            </Button>
            <div className="basis-full">
              <SaldoKurangRow id="galeri-d3-saldo">
                Saldo Tunai tinggal Rp 20.000. Kalau dipulihkan, saldonya jadi −Rp 30.000.
              </SaldoKurangRow>
            </div>
          </VoidedBanner>
          <VoidedBanner>
            <Button variant="secondary" size="sm">
              {VOIDED_COPY.restore}
            </Button>
            <div className="basis-full">
              <p className="flex items-start gap-1.5 text-meta font-semibold text-danger">
                <WarningCircleIcon size={16} weight="fill" className="mt-px shrink-0" />
                <span>Belum bisa dipulihkan. Periksa koneksi lalu coba lagi.</span>
              </p>
            </div>
          </VoidedBanner>
        </Frame>
      </div>
      {sheet === null ? null : (
        <EditSheet
          key={sheet}
          open
          onOpenChange={(o) => {
            if (!o) setSheet(null);
          }}
          ruang="pribadi"
          entry={
            sheet === 'saldo'
              ? { ...LIVE, amount: 50_000, accountId: 'a-2', accountName: 'Tunai' }
              : LIVE
          }
          accounts={ACCOUNTS}
          categories={CATEGORIES}
          today={TODAY}
          me={ME}
          source={fakeSource(sheet)}
          now={() => new Date('2026-10-31T12:00:00+07:00')}
        />
      )}
      <VoidDialogView
        open={dialog}
        onOpenChange={setDialog}
        onConfirm={noop}
        description={voidSentenceVM(LIVE)}
      />
    </CatatProvider>
  );
}
