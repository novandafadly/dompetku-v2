import type { Route } from 'next';
import Link from 'next/link';
import { WalletTypeIcon } from '@/components/ui/category-icon';
import { CaretRightIcon } from '@/components/ui/icons/caret-right';
import { ListCard } from '@/components/ui/list-card';
import { rowSub } from '@/components/ui/row-text';
import { rowDivider, rowLink, tile } from '@/components/ui/styles';
import type { AccountVM } from '@/features/ledger/types';
import { WALLET_TYPE_LABEL } from './context';

/**
 * Kartu `Diarsipkan` (S7-W3) di paling bawah daftar Dompet: baris redup yang tetap menaut ke
 * riwayat, tanpa saldo (selalu 0) dan tanpa aksi pulihkan di S7. Tidak dirender bila kosong.
 */
export function ArchivedAccounts({
  accounts,
  accountHref,
}: {
  accounts: AccountVM[];
  accountHref: (id: string) => Route;
}) {
  if (accounts.length === 0) return null;
  return (
    <ListCard title="Diarsipkan">
      <ul>
        {accounts.map((a) => (
          <li key={a.id} className={rowDivider}>
            <Link href={accountHref(a.id)} className={rowLink}>
              <span aria-hidden="true" className={`size-10 ${tile} text-text-muted`}>
                <WalletTypeIcon type={a.walletType} size={20} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.75">
                <span className="block text-body/tight font-semibold break-words text-text-muted">
                  {a.name}
                </span>
                <span className={rowSub}>{WALLET_TYPE_LABEL[a.walletType]}</span>
              </span>
              <CaretRightIcon size={16} weight="bold" className="shrink-0 text-text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </ListCard>
  );
}
