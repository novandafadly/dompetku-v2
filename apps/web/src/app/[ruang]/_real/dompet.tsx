import type { IsoDate } from '@dompetku/domain';
import { ErrorState } from '@/components/ui/state';
import { card } from '@/components/ui/styles';
import { CardError } from '@/features/bersama/card-error';
import { AccountListView } from '@/features/dompet/account-list-view';
import { ArchivedAccounts } from '@/features/dompet/archived-accounts';
import { ModalCard } from '@/features/dompet/modal-card';
import { waitingItems, WaitingReimburseList } from '@/features/dompet/reimburse-list';
import type { AccountVM, ReimbursableVM, Ruang, TradingOverviewVM } from '@/features/ledger/types';
import { buildAccountHref, buildEntryHref, buildHref } from '@/features/shell/hrefs';
import { PageHeader } from '@/features/shell/page-header';
import { AddWalletHostIsland, AddWalletTriggerIsland } from './dompet-islands';
import { RetryIsland } from './transaksi-islands';

/**
 * Dompet mode nyata (Server Component): daftar dari `account_balances` ruang ini saja (`AccountVM`,
 * saldo dari VM). Tambah dompet = pulau klien (sheet dimuat malas; `?tambah=1` membukanya).
 * S7: kartu Menunggu reimburse di atas kelompok dompet (Pribadi saja, W4) dan kartu Diarsipkan
 * di bawah (W3). Cocokkan saldo dan arsip ada di riwayat dompet. S12: kelompok Trading dan kartu
 * Modal trading (Pribadi saja; angka dari `api.trading_overview`).
 */
export function DompetReal({
  ruang,
  query,
  today,
  accounts,
  reimbursables,
  archived,
  trading,
}: {
  ruang: Ruang;
  /** Query yang dibawa tautan (mode nyata: hanya `theme`), '' atau '?a=b'. */
  query: string;
  today: IsoDate;
  accounts: AccountVM[];
  /** Talangan terbuka; hanya dipakai di Pribadi (Bersama tidak punya talangan). */
  reimbursables: ReimbursableVM[];
  archived: AccountVM[];
  /** Hanya Pribadi dengan dompet trading aktif: angka modal, atau `error` bila gagal dimuat. */
  trading?: TradingOverviewVM | 'error' | null;
}) {
  const accountHref = (id: string) => buildAccountHref(ruang, id, query);
  // Bersama tidak pernah menampilkan talangan, apa pun yang diterima (page juga tidak memuatnya).
  const waiting = ruang === 'pribadi' ? reimbursables : [];
  const modal =
    ruang !== 'pribadi' || trading === undefined || trading === null ? undefined : trading ===
      'error' ? (
      <section aria-label="Modal trading" className={`px-4 pt-3 ${card}`}>
        <CardError
          message="Modal trading belum bisa dimuat."
          retryHref={buildHref(ruang, 'dompet', query)}
        />
      </section>
    ) : (
      <ModalCard variant="overview" figures={trading.total} />
    );
  return (
    <AddWalletHostIsland ruang={ruang} existingNames={accounts.map((a) => a.name)}>
      <PageHeader title="Dompet" action={<AddWalletTriggerIsland />} />
      <AccountListView
        ruang={ruang}
        accounts={accounts}
        accountHref={accountHref}
        renderAdd={(className) => <AddWalletTriggerIsland className={className} />}
        above={
          <WaitingReimburseList
            items={waitingItems(waiting, [...accounts, ...archived], today, (id) =>
              buildEntryHref(ruang, id, query),
            )}
            total={waiting.reduce((sum, r) => sum + r.remaining, 0)}
          />
        }
        below={<ArchivedAccounts accounts={archived} accountHref={accountHref} />}
        modal={modal}
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
