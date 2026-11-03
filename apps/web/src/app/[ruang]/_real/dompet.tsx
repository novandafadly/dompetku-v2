import { ErrorState } from '@/components/ui/state';
import { AccountListView } from '@/features/dompet/account-list-view';
import type { AccountVM, Ruang } from '@/features/ledger/types';
import { buildAccountHref } from '@/features/shell/hrefs';
import { PageHeader } from '@/features/shell/page-header';
import { AddWalletHostIsland, AddWalletTriggerIsland } from './dompet-islands';
import { RetryIsland } from './transaksi-islands';

/**
 * Dompet mode nyata (Server Component): daftar dari `account_balances` ruang ini saja (`AccountVM`,
 * saldo dari VM). Tambah dompet = pulau klien (sheet dimuat malas; `?tambah=1` membukanya).
 * Cocokkan saldo, ubah saldo awal, dan arsip dompet menyusul di S7:
 * tidak dirender.
 */
export function DompetReal({
  ruang,
  query,
  accounts,
}: {
  ruang: Ruang;
  /** Query yang dibawa tautan (mode nyata: hanya `theme`), '' atau '?a=b'. */
  query: string;
  accounts: AccountVM[];
}) {
  return (
    <AddWalletHostIsland ruang={ruang} existingNames={accounts.map((a) => a.name)}>
      <PageHeader title="Dompet" action={<AddWalletTriggerIsland />} />
      <AccountListView
        ruang={ruang}
        accounts={accounts}
        accountHref={(id) => buildAccountHref(ruang, id, query)}
        renderAdd={(className) => <AddWalletTriggerIsland className={className} />}
      />
    </AddWalletHostIsland>
  );
}

/** Gagal muat (galat loader ditangkap page): salinan tetap + Coba lagi (`router.refresh`). */
export function DompetFailed() {
  return (
    <>
      <PageHeader title="Dompet" />
      <div className="laptop:max-w-180">
        <ErrorState
          title="Dompet belum bisa dimuat."
          description="Periksa koneksi lalu coba lagi."
          actions={<RetryIsland />}
        />
      </div>
    </>
  );
}
