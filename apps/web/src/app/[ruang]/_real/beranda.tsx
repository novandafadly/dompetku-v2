import { dayLabel, fullDateLabel, type IsoDate } from '@dompetku/domain';
import Link from 'next/link';
import { buttonClass } from '@/components/ui/button';
import { PlusIcon } from '@/components/ui/icons/plus';
import {
  OnboardingChecklistView,
  type ChecklistStep,
} from '@/features/beranda/onboarding-checklist-view';
import { RecentEntriesView, type RecentRow } from '@/features/beranda/recent-entries-view';
import { SafeToSpendCard, SafeToSpendEmptyView } from '@/features/beranda/safe-to-spend-view';
import { entryKindLabelVM, entryTitleVM, signedAmountVM } from '@/features/ledger/present';
import type { Ruang } from '@/features/ledger/types';
import {
  buildAddWalletHref,
  buildAuthHref,
  buildEntryHref,
  buildHref,
} from '@/features/shell/hrefs';
import { PageHeader } from '@/features/shell/page-header';
import type { BerandaData } from '@/server/ledger/beranda';
import { markNoSpendDayAction } from '../_actions/beranda';
import { berandaSteps, type BerandaStepState } from './beranda-steps';
import { CatatStepIsland, NoSpendIsland } from './beranda-islands';

/**
 * Beranda mode nyata (Server Component): kartu utama (`SafeToSpendVM`), S6-B1, checklist,
 * Terakhir. Seksi anggaran, tagihan, dan feed aktivitas belum dirender (S8/S9). Dirangkai di
 * server dari data ruang ini saja; klien hanya menerima props tampilan, pulau klien = tombol
 * S6-B1 dan langkah Catat. Tanpa store demo.
 */
export function BerandaReal({
  ruang,
  today,
  query,
  data,
}: {
  ruang: Ruang;
  today: IsoDate;
  /** Query yang dibawa tautan (mode nyata: hanya `theme`), '' atau '?a=b'. */
  query: string;
  data: BerandaData;
}) {
  // Tambah dompet = Dompet ruang ini dengan sheet Tambah dompet terbuka (`?tambah=1`).
  const dompetHref = buildAddWalletHref(ruang, query);

  const toStep = (s: BerandaStepState): ChecklistStep => {
    switch (s.key) {
      case 'aman':
        return { key: s.key, done: s.done, label: 'Akun aman' };
      case 'dompet':
        return {
          key: s.key,
          done: s.done,
          label: ruang === 'bersama' ? 'Buat dompet bersama' : 'Tambah dompet sehari-hari',
          action: { kind: 'link', href: dompetHref },
        };
      case 'catat':
        return {
          key: s.key,
          done: s.done,
          label: 'Catat satu pengeluaran',
          action: { kind: 'element', element: <CatatStepIsland label="Catat satu pengeluaran" /> },
        };
      case 'undang':
        return {
          key: s.key,
          done: s.done,
          label: 'Undang Farida',
          action: { kind: 'link', href: buildAuthHref('undang', query) },
        };
    }
  };
  const steps = berandaSteps({
    ruang,
    hasOperasional: data.hasOperasional,
    hasExpense: data.hasExpense,
    invite: data.invite,
  });
  // Checklist hilang sesudah semua langkah selesai.
  const checklist = steps.every((s) => s.done) ? null : (
    <OnboardingChecklistView ruang={ruang} steps={steps.map(toStep)} />
  );

  const rows: RecentRow[] = data.recent.map((e) => {
    const { value, kind } = signedAmountVM(e);
    return {
      id: e.id,
      href: buildEntryHref(ruang, e.id, query),
      iconName: e.categoryName,
      entryKind: e.kind,
      label: entryTitleVM(e),
      meta: `${entryKindLabelVM(e)} · ${e.accountName} · ${dayLabel(e.occurredOn, today)}`,
      value,
      kind,
    };
  });
  const recent = <RecentEntriesView rows={rows} listHref={buildHref(ruang, 'transaksi', query)} />;

  const header = (
    <PageHeader
      title="Beranda"
      action={
        <span className="text-label font-semibold text-text-muted">{fullDateLabel(today)}</span>
      }
    />
  );

  if (!data.hasOperasional) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-3 laptop:max-w-180 laptop:gap-4">
          <SafeToSpendEmptyView
            ruang={ruang}
            today={today}
            action={
              <Link href={dompetHref} className={buttonClass('primary', 'md', 'self-start')}>
                <PlusIcon size={18} weight="bold" />
                Tambah dompet
              </Link>
            }
          />
          {checklist}
          {recent}
        </div>
      </>
    );
  }

  // HP: Aman → S6-B1 → checklist → Terakhir, satu kolom. Laptop: keputusan kiri, riwayat kanan.
  return (
    <>
      {header}
      <div className="grid grid-cols-1 gap-3 tablet:gap-4 laptop:max-w-250 laptop:grid-cols-beranda laptop:items-start laptop:gap-5">
        <div className="flex flex-col gap-3 tablet:gap-4">
          <SafeToSpendCard ruang={ruang} today={today} vm={data.safe} showObligations={false} />
          <NoSpendIsland
            hasExpense={data.today.hasExpense}
            noSpendMarked={data.today.noSpendMarked}
            onMark={markNoSpendDayAction.bind(null, ruang)}
          />
          {checklist}
        </div>
        <div className="flex flex-col gap-3 tablet:gap-4">{recent}</div>
      </div>
    </>
  );
}
