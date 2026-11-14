'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { AddWalletButton } from '@/features/dompet/add-wallet-button';
import type { AccountSubmit, AccountSubmitResult } from '@/features/dompet/add-account-sheet';
import type { Ruang } from '@/features/ledger/types';
import { createAccountAction } from '../_actions/dompet';

/**
 * Tambah dompet mode nyata (pulau klien, dimuat malas lewat `dompet-islands`). `AddWalletHost`
 * memegang state sheet; tombol (`AddWalletTrigger`) bisa di header, isi halaman, atau keadaan
 * kosong. Sheet-nya dimuat saat pertama dipakai (pointer/fokus = muat lebih awal). Terbuka bila
 * alamat memuat `?tambah=1` (S6-C6: tombol Tambah dompet di sheet Catat, juga saat Catat dibuka dari
 * layar Dompet ini sendiri); parameter itu dibuang dari alamat saat sheet ditutup, jadi dibuka lagi
 * oleh tautan berikutnya.
 */

const loadSheet = () => import('@/features/dompet/add-account-sheet');
const AddAccountSheet = lazy(() => loadSheet().then((m) => ({ default: m.AddAccountSheet })));
const preloadSheet = () => {
  void loadSheet();
};

const OpenAdd = createContext<(() => void) | null>(null);

/** Galat jaringan Server Action (fetch gagal) = `network`: "Coba lagi" memakai clientId yang sama. */
async function createAccount(
  ruang: Ruang,
  input: AccountSubmit,
  onIdemMismatch: () => void,
): Promise<AccountSubmitResult> {
  try {
    const res = await createAccountAction(ruang, input);
    if (res.ok) return { ok: true };
    // Kunci sama, isi beda: percobaan sebelumnya mungkin sudah tersimpan; muat ulang daftar.
    if (res.error.code === 'idem_mismatch') onIdemMismatch();
    return { ok: false, code: res.error.code };
  } catch {
    return { ok: false, code: 'network' };
  }
}

/** Buang `tambah` dari alamat tanpa navigasi (muat ulang tidak membuka sheet lagi). */
function dropAddParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('tambah')) return;
  url.searchParams.delete('tambah');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

export function AddWalletHost({
  ruang,
  existingNames,
  children,
}: {
  ruang: Ruang;
  existingNames: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const wantsAdd = useSearchParams().get('tambah') === '1';
  const [open, setOpen] = useState(wantsAdd);
  // Alamat berganti ke ?tambah=1 selagi halaman ini sudah terbuka: sheet ikut terbuka.
  const [prevWants, setPrevWants] = useState(wantsAdd);
  if (wantsAdd !== prevWants) {
    setPrevWants(wantsAdd);
    if (wantsAdd) setOpen(true);
  }
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
          <AddAccountSheet
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) dropAddParam();
            }}
            ruang={ruang}
            allowTrading={ruang === 'pribadi'}
            existingNames={existingNames}
            onSubmit={(input) =>
              createAccount(ruang, input, () => {
                router.refresh();
              })
            }
          />
        </Suspense>
      ) : null}
    </OpenAdd.Provider>
  );
}

export function AddWalletTrigger({ className = '' }: { className?: string }) {
  const open = useContext(OpenAdd);
  if (open === null) throw new Error('AddWalletTrigger harus di dalam AddWalletHost');
  return <AddWalletButton onAdd={open} onPreload={preloadSheet} className={className} />;
}

export type AddWalletHostProps = ComponentProps<typeof AddWalletHost>;
