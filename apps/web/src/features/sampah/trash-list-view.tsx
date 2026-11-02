'use client';

import { dayLabel, formatRupiah, fullDateLabel, type IsoDate } from '@dompetku/domain';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CategoryIcon } from '@/components/ui/category-icon';
import { ClockIcon } from '@/components/ui/icons/clock';
import { TrashIcon } from '@/components/ui/icons/trash';
import { MoneyText } from '@/components/ui/money-text';
import { EmptyState } from '@/components/ui/state';
import { card, rowDivider, tile } from '@/components/ui/styles';
import { entryKindLabelVM, entryTitleVM, signedAmountVM } from '@/features/ledger/present';
import type { EntryVM, TrashVM } from '@/features/ledger/types';
import { SAMPAH_TITLE_ID, TRASH_COPY } from './trash-states';

/** `YYYY-MM-DD` dari stempel ISO WIB (`2026-11-02T09:00:00+07:00`). */
const dateOf = (iso: string): IsoDate => iso.slice(0, 10);

/** Dompet entri: transfer satu ruang = "BCA → Tunai". */
function walletOf(e: EntryVM): string {
  return e.kind === 'transfer' && e.counterAccountName !== undefined
    ? `${e.accountName} → ${e.counterAccountName}`
    : e.accountName;
}

/** Yang diberikan baris ke tombol pulihkan buatan pemanggil. */
export interface RestoreSlot {
  /** Bagian nama tombol untuk pembaca layar: `{keterangan} {Rp}` (teks terlihat tetap `Pulihkan`). */
  labelSuffix: string;
  /** Panggil sesudah berhasil: fokus pindah begitu baris benar-benar hilang dari daftar. */
  onRestored: () => void;
}

/**
 * Tata letak baris: HP (< 600) keterangan penuh lebar, lalu nominal (kiri) + tombol (kanan) di
 * baris kedua, jadi nominal panjang (`Rp 12.345.678.900`) tidak memampatkan keterangan di 320 maupun
 * 390; tablet ke atas satu baris (keterangan, nominal, tombol).
 */
function TrashRow({
  today,
  item,
  restore,
  onRestored,
}: {
  today: IsoDate;
  item: TrashVM;
  restore: (item: TrashVM, slot: RestoreSlot) => ReactNode;
  onRestored: () => void;
}) {
  const { entry, purgeAfter } = item;
  const label = entryTitleVM(entry);
  const { value, kind } = signedAmountVM(entry);
  const voided =
    entry.voidedAt === undefined ? '' : ` · Dibatalkan ${dayLabel(dateOf(entry.voidedAt), today)}`;
  return (
    <li data-trash-row={entry.id} className={`py-3 ${rowDivider}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 basis-full items-start gap-3 tablet:grow tablet:basis-0">
          <span aria-hidden="true" className={`size-10 ${tile}`}>
            <CategoryIcon name={entry.categoryName} kind={entry.kind} size={20} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.75">
            <span className="block truncate text-body/tight font-semibold text-text">{label}</span>
            <span className="block text-meta font-medium break-words text-text-muted">
              {`${entryKindLabelVM(entry)} · ${walletOf(entry)}${voided}`}
            </span>
            <span className="flex items-start gap-1 text-meta font-medium text-text-muted">
              <ClockIcon size={14} className="mt-0.5 shrink-0" />
              {`Terhapus permanen ${fullDateLabel(dateOf(purgeAfter))}`}
            </span>
          </span>
        </div>
        <MoneyText value={value} kind={kind} className="shrink-0" />
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          {restore(item, { labelSuffix: `${label} ${formatRupiah(entry.amount)}`, onRestored })}
        </div>
      </div>
    </li>
  );
}

/**
 * Daftar Sampah (S6-S1) untuk kedua mode: entri batal ≤ 90 hari, satu baris per entri dengan
 * keterangan, meta (kategori · dompet · hari batal), `Terhapus permanen {tanggal}`, nominal, dan
 * tombol pulihkan buatan pemanggil (`restore`; fitur tidak mengimpor fitur lain). Baris bukan
 * tautan: hanya tombol yang interaktif (R1). Daftar datang dari pemanggil (server memuat ulang
 * sesudah action; store demo sinkron), jadi baris yang berhasil dipulihkan hilang dengan sendirinya;
 * fokus lalu pindah ke tombol baris berikutnya, atau ke judul halaman bila daftar habis.
 */
export function TrashListView({
  today,
  items,
  restore,
}: {
  today: IsoDate;
  items: TrashVM[];
  restore: (item: TrashVM, slot: RestoreSlot) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const pending = useRef<{ from: string; next: string | null } | null>(null);
  const [asked, setAsked] = useState(0);

  // Fokus sesudah baris yang dipulihkan benar-benar hilang dari daftar (bukan saat toast tampil).
  // `asked` memeriksa ulang bila daftar sudah berubah sebelum `onRestored` dipanggil (store demo
  // sinkron, atau payload server tiba lebih dulu).
  useEffect(() => {
    const p = pending.current;
    if (p === null || items.some((i) => i.entry.id === p.from)) return;
    pending.current = null;
    const row =
      p.next === null
        ? undefined
        : [...(root.current?.querySelectorAll<HTMLElement>('[data-trash-row]') ?? [])].find(
            (r) => r.dataset.trashRow === p.next,
          );
    const button = row?.querySelector<HTMLElement>('button');
    if (button) {
      button.focus();
      return;
    }
    const title = document.getElementById(SAMPAH_TITLE_ID);
    title?.setAttribute('tabindex', '-1');
    title?.focus();
  }, [items, asked]);

  if (items.length === 0) {
    return <EmptyState icon={<TrashIcon size={28} />} title={TRASH_COPY.empty} />;
  }

  return (
    <div ref={root} className="flex flex-col gap-3">
      <p className="text-meta font-medium text-text-muted">
        Transaksi yang dibatalkan tersimpan 90 hari. Pulihkan sebelum terhapus permanen.
      </p>
      <ul aria-label="Transaksi dibatalkan" className={`px-4 ${card}`}>
        {items.map((item, i) => (
          <TrashRow
            key={item.entry.id}
            today={today}
            item={item}
            restore={restore}
            onRestored={() => {
              const next = items[i + 1] ?? items[i - 1];
              pending.current = { from: item.entry.id, next: next?.entry.id ?? null };
              setAsked((n) => n + 1);
            }}
          />
        ))}
      </ul>
    </div>
  );
}
