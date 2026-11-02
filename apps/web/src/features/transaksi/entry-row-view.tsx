import type { Route } from 'next';
import { CategoryIcon } from '@/components/ui/category-icon';
import { ClockIcon } from '@/components/ui/icons/clock';
import { TxRow } from '@/components/ui/rows';
import { entryKindLabelVM, entryTitleVM, signedAmountVM } from '@/features/ledger/present';
import type { EntryVM } from '@/features/ledger/types';

/**
 * Baris Transaksi dari `EntryVM`, untuk kedua mode: mode nyata merendernya di server, pembungkus
 * demo (`EntryRow`) memetakan entri demo ke VM lebih dulu. `reimburse` hanya ada di data demo.
 */
export function EntryRowView({
  entry,
  href,
  reimburse = false,
}: {
  entry: EntryVM;
  href: Route;
  reimburse?: boolean;
}) {
  const { value, kind } = signedAmountVM(entry);
  const wallet =
    entry.kind === 'transfer' && entry.counterAccountName !== undefined
      ? `${entry.accountName} → ${entry.counterAccountName}`
      : entry.accountName;
  return (
    <TxRow
      href={href}
      icon={<CategoryIcon name={entry.categoryName} kind={entry.kind} size={20} />}
      label={entryTitleVM(entry)}
      meta={`${entryKindLabelVM(entry)} · ${wallet}`}
      status={
        reimburse ? (
          <span className="flex items-center gap-1 text-meta font-semibold text-warning">
            <ClockIcon size={14} className="shrink-0" />
            Menunggu reimburse
          </span>
        ) : undefined
      }
      value={value}
      kind={kind}
    />
  );
}
