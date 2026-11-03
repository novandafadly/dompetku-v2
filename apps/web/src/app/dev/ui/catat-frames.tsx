'use client';

import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CatatSheet } from '@/features/catat/catat-sheet';
import {
  accountArchivedText,
  beforeOpeningText,
  CATAT_COPY,
  CatatAlert,
  FieldErrorText,
  NoAccountState,
  SaldoKurangRow,
  SavingLabel,
  saldoKurangText,
} from '@/features/catat/catat-status';
import type { CatatOptions, CatatSource, SaveOutcome } from '@/features/catat/source';
import type { AccountVM, CategoryVM, LedgerErrorCode, Ruang } from '@/features/ledger/types';

/** Bingkai S6-C1…C6 (docs/design/s6-bingkai.md) di atas sumber palsu: tanpa store demo, tanpa server. */

const TODAY = '2026-10-31';

const account = (id: string, name: string, balance: number, openedOn: string): AccountVM => ({
  id,
  name,
  pocket: 'operasional',
  walletType: 'bank',
  openedOn,
  archived: false,
  balance,
});

const category = (
  id: string,
  name: string,
  type: 'income' | 'expense' = 'expense',
): CategoryVM => ({
  id,
  parentId: null,
  name,
  type,
  icon: 'Tag',
  archived: false,
});

const CATEGORIES: CategoryVM[] = [
  category('makan', 'Makan'),
  category('kopi', 'Kopi & Camilan'),
  category('transport', 'Transportasi'),
  category('belanja', 'Belanja'),
  category('rumah', 'Rumah Tangga'),
  category('hiburan', 'Hiburan'),
  category('kesehatan', 'Kesehatan'),
  category('gaji', 'Gaji', 'income'),
];

const OPTIONS: CatatOptions = {
  accounts: [
    account('bca', 'BCA', 120_000, '2026-10-25'),
    account('tunai', 'Tunai', 450_000, '2026-01-01'),
  ],
  categories: CATEGORIES,
};

type FrameId =
  | 'c1'
  | 'c2'
  | 'c2-server'
  | 'c2-tidak-ada'
  | 'c3'
  | 'c4'
  | 'c5-tanggal'
  | 'c5-dompet'
  | 'c5-kategori'
  | 'c6';

const FRAMES: { id: FrameId; label: string; fail?: LedgerErrorCode }[] = [
  { id: 'c1', label: 'S6-C1 Menyimpan…' },
  { id: 'c2', label: 'S6-C2 Galat simpan', fail: 'network' },
  { id: 'c3', label: 'S6-C3 Saldo tidak cukup', fail: 'saldo_negatif' },
  { id: 'c4', label: 'S6-C4 Kunci bentrok', fail: 'idem_mismatch' },
  { id: 'c5-tanggal', label: 'S6-C5 Sebelum dompet dibuka', fail: 'before_opening' },
  { id: 'c5-dompet', label: 'S6-C5 Dompet diarsipkan', fail: 'account_archived' },
  { id: 'c5-kategori', label: 'S6-C5 Kategori diarsipkan', fail: 'category_archived' },
  { id: 'c2-server', label: 'Galat server', fail: 'unknown' },
  { id: 'c2-tidak-ada', label: 'Data tidak ada', fail: 'not_found' },
  { id: 'c6', label: 'S6-C6 Ruang tanpa dompet' },
];

function fakeSource(frame: FrameId): CatatSource {
  const spec = FRAMES.find((f) => f.id === frame);
  return {
    ruangLabel: { pribadi: 'Pribadi', bersama: 'Bersama' },
    options: () => (frame === 'c6' ? { accounts: [], categories: CATEGORIES } : OPTIONS),
    chips: (_r, type) => CATEGORIES.filter((c) => c.type === type).slice(0, 6),
    spaceTransferTargets: () => [],
    save: () => {
      // C1: jawaban server tidak pernah datang, agar keadaan menyimpan bisa ditinjau.
      if (frame === 'c1') return new Promise<SaveOutcome>(() => undefined);
      const code = spec?.fail;
      return Promise.resolve<SaveOutcome>(
        code === undefined
          ? {
              ok: true,
              entryId: 'contoh',
              version: 1,
              replayed: false,
              toast: 'Tersimpan di Pribadi · Rp 150.000 dari BCA',
            }
          : { ok: false, code },
      );
    },
    undo: () => Promise.resolve(true),
  };
}

/** Pesan inline S6-C1…C6 berdampingan (tanpa sheet), untuk tinjauan kontras dan tata letak. */
function InlineFrames() {
  const addRef = useRef<HTMLButtonElement>(null);
  return (
    <div data-ruang="pribadi" className="flex flex-col gap-3 rounded-xl bg-surface p-4">
      <p className="text-meta font-semibold text-text-muted">S6-C1</p>
      <Button
        aria-disabled="true"
        aria-busy="true"
        className="aria-disabled:border-hairline aria-disabled:bg-surface-2 aria-disabled:text-text-muted"
      >
        <SavingLabel />
      </Button>
      <p className="text-meta font-semibold text-text-muted">S6-C2</p>
      <CatatAlert id="galeri-c2" tone="danger">
        {CATAT_COPY.galat}
      </CatatAlert>
      <p className="text-meta font-semibold text-text-muted">S6-C2 mode keyboard</p>
      <CatatAlert id="galeri-c2-ringkas" tone="danger" compact>
        {CATAT_COPY.galat}
      </CatatAlert>
      <p className="text-meta font-semibold text-text-muted">S6-C3</p>
      <SaldoKurangRow id="galeri-c3">{saldoKurangText('BCA', 120_000, -30_000)}</SaldoKurangRow>
      <p className="text-meta font-semibold text-text-muted">S6-C4</p>
      <CatatAlert id="galeri-c4" tone="warning">
        {CATAT_COPY.idem}
      </CatatAlert>
      <p className="text-meta font-semibold text-text-muted">S6-C5</p>
      <FieldErrorText id="galeri-c5a">{beforeOpeningText('BCA', '2026-10-25')}</FieldErrorText>
      <FieldErrorText id="galeri-c5b">{accountArchivedText('BCA')}</FieldErrorText>
      <p className="text-meta font-semibold text-text-muted">S6-C6</p>
      <NoAccountState id="galeri-c6" ruang="Bersama" buttonRef={addRef} onAdd={() => undefined} />
    </div>
  );
}

export function CatatFrames() {
  const [frame, setFrame] = useState<FrameId | null>(null);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const source = useMemo(() => (frame === null ? null : fakeSource(frame)), [frame]);
  const ruang: Ruang = frame === 'c6' ? 'bersama' : 'pribadi';
  return (
    <>
      <InlineFrames />
      <p className="text-meta text-text-muted">
        Buka bingkai, isi nominal (C3: lebih dari Rp 120.000), pilih kategori, lalu Simpan.
      </p>
      <div className="flex flex-wrap gap-2">
        {FRAMES.map((f) => (
          <Button
            key={f.id}
            variant="secondary"
            size="sm"
            onClick={(e) => {
              setOpener(e.currentTarget);
              setFrame(f.id);
            }}
          >
            {f.label}
          </Button>
        ))}
      </div>
      {source === null ? null : (
        <CatatSheet
          key={frame}
          open={frame !== null}
          onOpenChange={(o) => {
            if (!o) setFrame(null);
          }}
          ruang={ruang}
          source={source}
          today={TODAY}
          keypad="os"
          hourWIB={12}
          returnFocus={opener}
          initialAmount={frame === 'c3' ? 150_000 : 35_000}
          onAddAccount={() => undefined}
        />
      )}
    </>
  );
}
