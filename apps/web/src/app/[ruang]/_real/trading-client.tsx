'use client';

import type { IsoDate, Rupiah } from '@dompetku/domain';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import type { CatatSource } from '@/features/catat/source';
import type { AccountVM, Ruang } from '@/features/ledger/types';
import { RUANG_LABEL } from '@/features/shell/hrefs';
import { realCatatSource } from './catat-source-real';

/**
 * Aksi `Setor modal` / `Tarik modal` di riwayat dompet trading (S12-TR3/TR4; pulau klien dimuat
 * malas lewat `trading-islands`). Memakai sheet Catat yang ada dalam mode transfer dengan arah dan
 * dompet trading terkunci (`preset`); simpan = `saveCatat` transfer biasa, jadi modal bukan
 * pemasukan/pengeluaran. Sheet dimuat saat pertama dipakai. Sumber dibuat dari dompet halaman ini
 * (props server), jadi saldo untuk `Tetap simpan` ikut segar sesudah `refresh()` action simpan.
 */

const loadSheet = () => import('@/features/catat/catat-sheet');
const CatatSheet = lazy(() => loadSheet().then((m) => ({ default: m.CatatSheet })));
const preloadSheet = () => {
  void loadSheet();
};

export interface ModalActionsProps {
  ruang: Ruang;
  today: IsoDate;
  account: { id: string; name: string; balance: Rupiah };
  /** Sisa modal dompet ini (SQL), untuk pratinjau penarikan di atas modal. */
  capitalLeft: Rupiah;
  /** Dompet ruang ini (Pribadi), pilihan sisi lawan. */
  accounts: AccountVM[];
}

export function ModalActions({ ruang, today, account, capitalLeft, accounts }: ModalActionsProps) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'setor' | 'tarik'>('setor');
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  const mounted = useOpenedOnce(open);
  // Satu sumber per set dompet: opsi ruang ini dari props, tanpa kategori (transfer tidak memakainya).
  const source = useMemo<CatatSource>(
    () => ({
      ...realCatatSource({ ruang, options: { accounts, categories: [] }, ruangLabel: RUANG_LABEL }),
      // Modal bukan alur Catat: tidak ikut metrik `catat_dibuka`/`catat_disimpan`.
      track: () => undefined,
    }),
    [ruang, accounts],
  );
  const openAs = (next: 'setor' | 'tarik', el: HTMLElement) => {
    setKind(next);
    setReturnFocus(el);
    setOpen(true);
  };
  // Tarik tidak ada bila tidak ada yang bisa ditarik (saldo 0 dan modal 0).
  const canWithdraw = account.balance > 0 || capitalLeft > 0;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onPointerEnter={preloadSheet}
          onFocus={preloadSheet}
          onClick={(e) => {
            openAs('setor', e.currentTarget);
          }}
        >
          Setor modal
        </Button>
        {canWithdraw ? (
          <Button
            variant="secondary"
            size="sm"
            onPointerEnter={preloadSheet}
            onFocus={preloadSheet}
            onClick={(e) => {
              openAs('tarik', e.currentTarget);
            }}
          >
            Tarik modal
          </Button>
        ) : null}
      </div>
      {mounted ? (
        <Suspense fallback={null}>
          <CatatSheet
            open={open}
            onOpenChange={setOpen}
            ruang={ruang}
            source={source}
            today={today}
            keypad="os"
            returnFocus={returnFocus}
            preset={{ kind, account: { id: account.id, name: account.name }, capitalLeft }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
