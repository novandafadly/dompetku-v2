'use client';

import type { IsoDate, Rupiah } from '@dompetku/domain';
import { useRouter } from 'next/navigation';
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { PlusIcon } from '@/components/ui/icons/plus';
import { toast } from '@/components/ui/toast';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { focusRing } from '@/components/ui/styles';
import { newClientId } from '@/features/catat/client-id';
import { undoOrNotify } from '@/features/catat/saved-toast';
import { ASET_COPY as C } from '@/features/aset/copy';
import type { AddAssetResult, AddAssetSubmit } from '@/features/aset/add-asset-sheet';
import type { RevalueSaved, RevalueSource } from '@/features/aset/revalue-sheet';
import type { CatatSource } from '@/features/catat/source';
import type { AccountVM, Ruang } from '@/features/ledger/types';
import { buildAccountHref, RUANG_LABEL } from '@/features/shell/hrefs';
import { createAssetAction, revalueAssetAction } from '../_actions/aset';
import { voidEntryAction } from '../_actions/entri';
import { realCatatSource } from './catat-source-real';

/**
 * Pulau klien Aset nyata (S14; dimuat malas lewat `aset-islands`, satu chunk `aset-client`):
 * `AddAssetHost` + `AddAssetTrigger` (sheet `Tambah aset`, dimuat saat pertama dipakai) dan
 * `RevalueButton` (sheet `Perbarui nilai`). Server Action `mutate` memanggil `refresh()`, jadi
 * daftar dan saldo tampil ulang tanpa navigasi. Galat jaringan = `network` (Coba lagi memakai
 * `clientId` yang sama).
 */

const loadAdd = () => import('@/features/aset/add-asset-sheet');
const AddAssetSheet = lazy(() => loadAdd().then((m) => ({ default: m.AddAssetSheet })));
const preloadAdd = () => {
  void loadAdd();
};
const loadRevalue = () => import('@/features/aset/revalue-sheet');
const RevalueSheet = lazy(() => loadRevalue().then((m) => ({ default: m.RevalueSheet })));
const preloadRevalue = () => {
  void loadRevalue();
};

const OpenAdd = createContext<(() => void) | null>(null);

export interface AddAssetHostProps {
  ruang: Ruang;
  today: IsoDate;
  /** Alamat dibawa tautan (`?theme=`), dipakai ke Detail dompet saham sesudah Tambah aset Saham. */
  query: string;
  existingNames: string[];
  children: ReactNode;
}

async function createAsset(
  ruang: Ruang,
  input: AddAssetSubmit,
  onIdemMismatch: () => void,
): Promise<AddAssetResult> {
  try {
    const res = await createAssetAction(ruang, input);
    if (res.ok) return { ok: true, accountId: res.value.accountId };
    if (res.error.code === 'idem_mismatch') onIdemMismatch();
    return res.error.field === undefined
      ? { ok: false, code: res.error.code }
      : { ok: false, code: res.error.code, field: res.error.field };
  } catch {
    return { ok: false, code: 'network' };
  }
}

export function AddAssetHost({ ruang, today, query, existingNames, children }: AddAssetHostProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const mounted = useOpenedOnce(open);
  return (
    <OpenAdd.Provider
      value={() => {
        setOpen(true);
      }}
    >
      {children}
      {mounted ? (
        <Suspense fallback={null}>
          <AddAssetSheet
            open={open}
            onOpenChange={setOpen}
            ruang={ruang}
            today={today}
            existingNames={existingNames}
            onSubmit={(input) =>
              createAsset(ruang, input, () => {
                router.refresh();
              })
            }
            onSaved={({ accountId, name, assetKind }) => {
              setOpen(false);
              toast({ message: C.added(name, ruang) });
              // Saham: langsung ke dompetnya (kosong); isinya lewat Beli saham (Task 10).
              if (assetKind === 'saham') router.push(buildAccountHref(ruang, accountId, query));
            }}
          />
        </Suspense>
      ) : null}
    </OpenAdd.Provider>
  );
}

/** Tautan teks 44 `Tambah aset` (HP/tablet) atau tombol sekunder (header laptop). */
export function AddAssetTrigger({
  className = '',
  variant = 'link',
}: {
  className?: string;
  variant?: 'link' | 'secondary';
}) {
  const open = useContext(OpenAdd);
  if (open === null) throw new Error('AddAssetTrigger harus di dalam AddAssetHost');
  if (variant === 'secondary') {
    return (
      <Button
        variant="secondary"
        onClick={open}
        onPointerEnter={preloadAdd}
        onFocus={preloadAdd}
        className={className}
      >
        <PlusIcon size={18} weight="bold" />
        {C.add}
      </Button>
    );
  }
  return (
    <button
      type="button"
      onClick={open}
      onPointerEnter={preloadAdd}
      onFocus={preloadAdd}
      className={`inline-flex min-h-11 items-center justify-center gap-1.5 self-center rounded-md px-3 text-label font-bold text-accent-text hover-pointer:underline ${focusRing} ${className}`}
    >
      <PlusIcon size={16} weight="bold" />
      {C.add}
    </button>
  );
}

function realRevalueSource(ruang: Ruang): RevalueSource {
  return {
    async revalue(req) {
      try {
        const res = await revalueAssetAction(ruang, req);
        return res.ok
          ? { ok: true, value: { entryId: res.value.entryId, delta: res.value.delta } }
          : res;
      } catch {
        return { ok: false, error: { code: 'network' } };
      }
    },
  };
}

export const REVALUE_UNDO_FAILED =
  'Belum bisa diurungkan. Buka perubahan nilai itu di riwayat aset untuk membatalkannya.';

export interface RevalueButtonProps {
  ruang: Ruang;
  today: IsoDate;
  asset: { id: string; name: string; balance: Rupiah; lastOn: IsoDate | null };
}

export function RevalueButton({ ruang, today, asset }: RevalueButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  const mounted = useOpenedOnce(open);
  const source = useMemo(() => realRevalueSource(ruang), [ruang]);

  function saved({ entryId }: RevalueSaved) {
    router.refresh();
    if (entryId === null) {
      // Di server nilainya sudah sama (berubah sejak sheet dibuka): tidak ada entri.
      toast({ message: `Nilai ${asset.name} sudah sama. Tidak ada yang dicatat.` });
      return;
    }
    // Entri valuasi baru selalu versi 1; satu clientId per toast (klik berulang = permintaan sama).
    const clientId = newClientId();
    let running = false;
    toast({
      message: C.revalued(asset.name),
      action: {
        label: C.undo,
        onAction: () => {
          if (running) return;
          running = true;
          void undoOrNotify(
            async (id: string) => {
              const res = await voidEntryAction(ruang, {
                clientId,
                entryId: id,
                expectedVersion: 1,
              });
              if (res.ok) router.refresh();
              return res.ok;
            },
            entryId,
            toast,
            REVALUE_UNDO_FAILED,
          ).finally(() => {
            running = false;
          });
        },
      },
    });
  }

  return (
    <>
      <Button
        onPointerEnter={preloadRevalue}
        onFocus={preloadRevalue}
        onClick={(e) => {
          setReturnFocus(e.currentTarget);
          setOpen(true);
        }}
      >
        {C.revalue}
      </Button>
      {mounted ? (
        <Suspense fallback={null}>
          <RevalueSheet
            open={open}
            onOpenChange={setOpen}
            ruang={ruang}
            today={today}
            asset={asset}
            source={source}
            onSaved={saved}
            onStale={() => {
              router.refresh();
            }}
            returnFocus={returnFocus}
          />
        </Suspense>
      ) : null}
    </>
  );
}

const loadCatat = () => import('@/features/catat/catat-sheet');
const CatatSheet = lazy(() => loadCatat().then((m) => ({ default: m.CatatSheet })));
const preloadCatat = () => {
  void loadCatat();
};

export interface AssetTransferProps {
  ruang: Ruang;
  today: IsoDate;
  account: { id: string; name: string; balance: Rupiah };
  /** Dompet ruang ini: pilihan sisi lawan (dompet biasa; aset dan Trading disaring sheet). */
  accounts: AccountVM[];
}

/**
 * `Isi dari dompet` / `Cairkan ke dompet` di Detail aset (S14-AS5): sheet Catat yang ada dalam mode
 * transfer dengan arah dan aset terkunci (`preset`, pola Setor/Tarik modal). Simpan = transfer biasa,
 * jadi bukan pemasukan/pengeluaran. `Cairkan` tidak ada bila nilai aset 0 (tidak ada yang bisa
 * dicairkan).
 */
export function AssetTransferButtons({ ruang, today, account, accounts }: AssetTransferProps) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'isi' | 'cairkan'>('isi');
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  const mounted = useOpenedOnce(open);
  // Opsi ruang ini dari props, tanpa kategori; tanpa metrik Catat (bukan alur catat harian).
  const source = useMemo<CatatSource>(
    () => ({
      ...realCatatSource({ ruang, options: { accounts, categories: [] }, ruangLabel: RUANG_LABEL }),
      track: () => undefined,
    }),
    [ruang, accounts],
  );
  const openAs = (next: 'isi' | 'cairkan', el: HTMLElement) => {
    setKind(next);
    setReturnFocus(el);
    setOpen(true);
  };
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onPointerEnter={preloadCatat}
        onFocus={preloadCatat}
        onClick={(e) => {
          openAs('isi', e.currentTarget);
        }}
      >
        {C.fill}
      </Button>
      {account.balance > 0 ? (
        <Button
          variant="secondary"
          size="sm"
          onPointerEnter={preloadCatat}
          onFocus={preloadCatat}
          onClick={(e) => {
            openAs('cairkan', e.currentTarget);
          }}
        >
          {C.withdraw}
        </Button>
      ) : null}
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
            preset={{ kind, account: { id: account.id, name: account.name }, capitalLeft: 0 }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
