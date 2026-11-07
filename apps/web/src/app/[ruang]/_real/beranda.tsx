import { dayLabel, fullDateLabel, type IsoDate } from '@dompetku/domain';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClass } from '@/components/ui/button';
import { PlusIcon } from '@/components/ui/icons/plus';
import {
  BERSAMA_SOLO_INTRO,
  BersamaAktivitasKosong,
  BersamaInviteCard,
  BersamaKosongCard,
} from '@/features/beranda/bersama-views';
import {
  OnboardingChecklistView,
  type ChecklistStep,
} from '@/features/beranda/onboarding-checklist-view';
import { ActivityCardError, ActivityCardView } from '@/features/bersama/activity-card-view';
import {
  ContributionCardError,
  ContributionCardView,
} from '@/features/bersama/contribution-card-view';
import { RecentEntriesView, type RecentRow } from '@/features/beranda/recent-entries-view';
import { AmanCardView } from '@/features/beranda/aman-card-view';
import { SafeToSpendEmptyView } from '@/features/beranda/safe-to-spend-view';
import {
  entryKindLabelVM,
  entryTitleVM,
  feeNoteVM,
  signedAmountVM,
} from '@/features/ledger/present';
import type { Ruang } from '@/features/ledger/types';
import {
  buildAddWalletHref,
  buildAktivitasHref,
  buildAuthHref,
  buildEntryHref,
  buildHref,
} from '@/features/shell/hrefs';
import { PageHeader } from '@/features/shell/page-header';
import type { BerandaData } from '@/server/ledger/beranda';
import { markNoSpendDayAction } from '../_actions/beranda';
import { BillsDueCard } from './bills-due-view';
import { BudgetsNearCard } from './budgets-near-view';
import { berandaSteps, bersamaView, type BerandaStepState } from './beranda-steps';
import { CatatStepIsland, NoSpendIsland } from './beranda-islands';

/**
 * Beranda mode nyata (Server Component): kartu utama (`SafeToSpendVM`), S6-B1, checklist,
 * Terakhir; Bersama dua anggota juga Kontribusi dan Aktivitas (S8). S9: kartu Aman lengkap
 * (`AmanCardView`: periode gajian, status, tagihan + wajib), Tagihan 7 hari, Anggaran hampir habis
 * (Server Component murni, tanpa JS baru). Dirangkai di
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
  const view = bersamaView(ruang, data.bersama);
  const steps = berandaSteps({
    ruang,
    hasOperasional: data.hasOperasional,
    hasExpense: data.hasExpense,
    invite: data.invite,
  });
  // Checklist hilang sesudah semua langkah selesai.
  const checklist = steps.every((s) => s.done) ? null : (
    <OnboardingChecklistView
      ruang={ruang}
      steps={steps.map(toStep)}
      {...(view.solo ? { intro: BERSAMA_SOLO_INTRO } : {})}
      {...(data.bersama?.partner ? { partnerName: data.bersama.partner.name } : {})}
    />
  );
  // Ajakan hanya untuk pemilik: bukan pemilik tidak menerima data undangan sama sekali.
  const invite =
    view.invite === 'none' ? null : (
      <BersamaInviteCard
        href={buildAuthHref('undang', query)}
        pending={view.invite === 'menunggu' ? (data.bersama?.pendingInvite ?? null) : null}
      />
    );
  // Bersama dua anggota (S8): kartu Aktivitas dari feed dan Kontribusi bulan ini. Solo tetap S7-B1.
  const b = ruang === 'bersama' && !view.solo ? data.bersama : null;
  const retryHref = buildHref(ruang, 'beranda', query);
  let aktivitas: ReactNode = null;
  if (view.solo) aktivitas = <BersamaAktivitasKosong />;
  else if (b?.activity === 'error') aktivitas = <ActivityCardError retryHref={retryHref} />;
  else if (b?.activity != null) {
    aktivitas = (
      <ActivityCardView
        items={b.activity}
        listHref={b.activity.length === 0 ? null : buildAktivitasHref(query)}
        emptyNames={b.partner?.name ?? null}
        today={today}
        query={query}
      />
    );
  }
  let kontribusi: ReactNode = null;
  if (b?.contributions === 'error') kontribusi = <ContributionCardError retryHref={retryHref} />;
  else if (b?.contributions != null) kontribusi = <ContributionCardView vm={b.contributions} />;

  const rows: RecentRow[] = data.recent.map((e) => {
    const { value, kind } = signedAmountVM(e);
    const note = feeNoteVM(e);
    return {
      id: e.id,
      href: buildEntryHref(ruang, e.id, query),
      iconName: e.categoryName,
      entryKind: e.kind,
      label: entryTitleVM(e),
      meta: `${entryKindLabelVM(e)} · ${e.accountName} · ${dayLabel(e.occurredOn, today)}`,
      ...(note === undefined ? {} : { note }),
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

  // S7-B2: Bersama tanpa dompet operasional dan tanpa entri. Kosong, ajakan, checklist, Aktivitas.
  if (view.empty) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-3 laptop:max-w-180 laptop:gap-4">
          <BersamaKosongCard addWalletHref={dompetHref} />
          {invite}
          {checklist}
          {aktivitas}
        </div>
      </>
    );
  }

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
          {invite}
          {checklist}
          {recent}
          {aktivitas}
        </div>
      </>
    );
  }

  // HP: Aman → S6-B1 → checklist → (Bersama) Kontribusi → Aktivitas → Terakhir, satu kolom. Laptop: keputusan kiri, riwayat kanan.
  return (
    <>
      {header}
      <div className="grid grid-cols-1 gap-3 tablet:gap-4 laptop:max-w-250 laptop:grid-cols-beranda laptop:items-start laptop:gap-5">
        <div className="flex flex-col gap-3 tablet:gap-4">
          <AmanCardView
            ruang={ruang}
            vm={data.safe}
            holidayNote={!data.period.holidaysKnown && data.period.basis === 'gajian'}
          />
          {invite}
          <NoSpendIsland
            hasExpense={data.today.hasExpense}
            noSpendMarked={data.today.noSpendMarked}
            onMark={markNoSpendDayAction.bind(null, ruang)}
          />
          {checklist}
          {/* S9-BR2: HP satu kolom, tablet dan laptop berdampingan (auto-fit). */}
          <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2 tablet:gap-4 laptop:grid-cols-autofit-260">
            <BillsDueCard ruang={ruang} query={query} today={today} data={data.billsDue} />
            <BudgetsNearCard ruang={ruang} query={query} data={data.budgetsNear} />
          </div>
          {kontribusi}
        </div>
        <div className="flex flex-col gap-3 tablet:gap-4">
          {/* Dua anggota: Aktivitas di atas Terakhir (sama dengan prototipe); solo tetap di bawah. */}
          {view.solo ? null : aktivitas}
          {recent}
          {view.solo ? aktivitas : null}
        </div>
      </div>
    </>
  );
}
