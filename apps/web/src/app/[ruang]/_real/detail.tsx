import { daysInclusive, formatRupiah, shortDateLabel, type IsoDate } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { buttonClass } from '@/components/ui/button';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { ClockIcon } from '@/components/ui/icons/clock';
import { InfoIcon } from '@/components/ui/icons/info';
import { WarningIcon } from '@/components/ui/icons/warning';
import { ErrorState } from '@/components/ui/state';
import { SpaceTag } from '@/components/ui/space-tag';
import { card, focusRing, rowDivider } from '@/components/ui/styles';
import type { EntryVM, Ruang, TalanganVM } from '@/features/ledger/types';
import { buildEntryHref, buildHref, RUANG_LABEL } from '@/features/shell/hrefs';
import { DetailRow, EntryDetailView } from '@/features/transaksi/entry-detail-view';
import { MovedBanner, VOIDED_COPY, VoidedBanner } from '@/features/transaksi/voided-banner';
import type { DetailData } from '@/server/ledger/detail';
import { DetailActionsIsland, RestoreIsland } from './detail-islands';
import { RetryIsland } from './transaksi-islands';

/** Saldo awal hanya bisa diubah (nominalnya saja) ≤ 7 hari sejak dompet dibuka (BSD §9.1). */
const OPENING_EDIT_DAYS = 7;

/** Hasil `detailAbilities`: apa yang dirender di bawah rincian (S6 + S7). */
export interface DetailAbilities {
  editable: boolean;
  voidable: boolean;
  /** "Pindahkan ke ruang lain" (S7-D2). */
  movable: boolean;
  /** Talangan yang masih menunggu diganti (S7-D3); `null` bila tidak ada atau sudah lunas. */
  reimbursable: { remaining: number } | null;
}

/**
 * Yang boleh dilakukan pada entri ini di mode nyata, sesuai `api.*`:
 * - Ubah: pemasukan/pengeluaran; saldo awal hanya nominal dan ≤ 7 hari. Transfer, cocokkan saldo,
 *   dan antar ruang ditolak `api.update_entry` (`kind_not_editable`): tanpa tombol Ubah.
 * - Batalkan: semua entri hidup kecuali saldo awal (`opening_locked`). Antar ruang hanya oleh
 *   pencatat (R25: bukan pencatat = `not_found`); talangan dengan reimburse hidup tidak
 *   (`reimbursement_exists`).
 * - Pindahkan (S7-D2): pemasukan/pengeluaran hidup oleh pencatat (R10), bukan talangan, bukan
 *   dompet Kantor (R17), dan pengguna anggota ≥ 2 ruang.
 * - Catat reimburse / Tidak diganti (S7-D3): talangan hidup yang masih punya sisa.
 */
export function detailAbilities(
  entry: EntryVM,
  data: Pick<DetailData, 'accounts'> & Partial<Pick<DetailData, 'spaceCount' | 'talangan'>>,
  today: IsoDate,
  me: string,
): DetailAbilities {
  const none: DetailAbilities = {
    editable: false,
    voidable: false,
    movable: false,
    reimbursable: null,
  };
  if (entry.voidedAt !== undefined) return none;
  if (entry.kind === 'opening_balance') {
    const opened = data.accounts.find((a) => a.id === entry.accountId)?.openedOn;
    const editable = opened !== undefined && daysInclusive(opened, today) - 1 <= OPENING_EDIT_DAYS;
    return { ...none, editable };
  }
  if (entry.kind === 'space_transfer') return { ...none, voidable: entry.createdBy.id === me };
  const talangan = data.talangan ?? null;
  const isIncomeOrExpense = entry.kind === 'income' || entry.kind === 'expense';
  const pocket = data.accounts.find((a) => a.id === entry.accountId)?.pocket;
  return {
    editable: isIncomeOrExpense,
    voidable: talangan === null || talangan.items.length === 0,
    movable:
      isIncomeOrExpense &&
      entry.createdBy.id === me &&
      entry.reimbursable !== true &&
      pocket !== undefined &&
      pocket !== 'kantor' &&
      (data.spaceCount ?? 0) >= 2,
    reimbursable:
      entry.kind === 'expense' && talangan !== null && talangan.remaining > 0
        ? { remaining: talangan.remaining }
        : null,
  };
}

const otherRuang = (r: Ruang): Ruang => (r === 'pribadi' ? 'bersama' : 'pribadi');

/** Baris status talangan di kartu atas (S7-D3): ikon + teks, tanpa `role="status"`. */
function TalanganStatus({ total, talangan }: { total: number; talangan: TalanganVM }) {
  if (talangan.remaining === 0) {
    return (
      <p className="flex items-center gap-1.5 text-label font-semibold text-accent-text">
        <CheckCircleIcon size={16} weight="fill" className="shrink-0" />
        Sudah diganti penuh
      </p>
    );
  }
  const sisa = formatRupiah(talangan.remaining);
  return (
    <p className="flex items-center gap-1.5 text-label font-semibold text-warning">
      <ClockIcon
        size={16}
        weight={talangan.items.length === 0 ? 'fill' : 'regular'}
        className="shrink-0"
      />
      {talangan.items.length === 0
        ? `Menunggu reimburse · sisa ${sisa}`
        : `Menunggu reimburse · sisa ${sisa} dari ${formatRupiah(total)}`}
    </p>
  );
}

/** Daftar reimburse hidup sebuah talangan (S7-D3): tiap baris tautan ke Detail reimburse. */
function ReimbursementList({ ruang, talangan }: { ruang: Ruang; talangan: TalanganVM }) {
  if (talangan.items.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-meta font-semibold text-text-soft">Reimburse</h2>
      <ul aria-label="Reimburse untuk talangan ini" className={`px-4 ${card}`}>
        {talangan.items.map((i) => (
          <li key={i.id} className={rowDivider}>
            <Link
              href={buildEntryHref(ruang, i.id, '')}
              className={`-mx-4 flex min-h-13 items-center px-4 text-body font-semibold text-text hover-pointer:bg-hover ${focusRing}`}
            >
              {`${shortDateLabel(i.occurredOn)} · ${formatRupiah(i.amount)}`}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Catatan statis di bawah tombol aksi (S7-D1, S7-D3): ikon `info` + 13/500 `text-muted`. */
function ActionNote({ children }: { children: string }) {
  return (
    <p className="flex items-center gap-1.5 text-meta font-medium text-text-muted">
      <InfoIcon size={14} className="shrink-0" />
      {children}
    </p>
  );
}

/**
 * Detail transaksi mode nyata (Server Component): `EntryDetailView` dirender di server dari data
 * ruang ini saja; aksi (Ubah, Batalkan, Pindahkan, reimburse, Pulihkan) adalah pulau klien yang
 * dimuat malas, dan sheet/dialog baru dimuat saat dipakai. Entri batal = banner S6-D3, entri yang
 * dipindah = banner S7-D2, bukan 404. Ruang lain tidak pernah dimuat di sini (id kaki lawan dan
 * dompet Pribadi tidak masuk payload RSC rute Bersama).
 */
export function DetailReal({
  ruang,
  today,
  me,
  listHref,
  data,
  labels,
}: {
  ruang: Ruang;
  today: IsoDate;
  /** Id pengguna sekarang ("Dicatat oleh kamu", konflik dari tab sendiri). */
  me: string;
  listHref: Route;
  data: DetailData;
  /**
   * Judul, label kategori, nominal bertanda (`detailLabels` dari `features/ledger/present`,
   * dihitung page di server). Diterima jadi agar modul ini (juga dipakai galeri klien) tidak
   * menjadi importir kedua `present.ts` (ADR 0002, lihat `EntryDetailView`).
   */
  labels: Pick<ComponentProps<typeof EntryDetailView>, 'title' | 'category' | 'amount'>;
}) {
  const { entry, accounts, categories, talangan } = data;
  const voidedAt = entry.voidedAt;
  const moved = entry.movedAt !== undefined;
  const tujuan = otherRuang(ruang);
  const { editable, voidable, movable, reimbursable } = detailAbilities(entry, data, today, me);
  const by = entry.createdBy.id === me ? 'kamu' : entry.createdBy.name;
  const antarRuang = entry.kind === 'space_transfer';
  const creator = entry.createdBy.id === me;

  const banner = moved ? (
    <MovedBanner tujuan={RUANG_LABEL[tujuan]}>
      <Link
        href={buildHref(tujuan, 'transaksi', '')}
        className={buttonClass('secondary', 'sm', 'self-start')}
      >
        {`Buka di ${RUANG_LABEL[tujuan]}`}
      </Link>
    </MovedBanner>
  ) : voidedAt === undefined ? null : (
    <VoidedBanner>
      {data.restoreClosed ? (
        <p className="flex items-center gap-1.5 text-meta font-semibold text-warning">
          <WarningIcon size={16} weight="fill" className="shrink-0" />
          {VOIDED_COPY.closed}
        </p>
      ) : antarRuang && !creator ? (
        <p className="text-meta font-medium text-text-muted">
          {`Hanya ${entry.createdBy.name} yang bisa memulihkan.`}
        </p>
      ) : (
        <RestoreIsland ruang={ruang} entry={entry} accounts={accounts} />
      )}
    </VoidedBanner>
  );

  // Kaki Pribadi: `Pribadi → Bersama`; panah bukan satu-satunya penanda (teks `sr-only`).
  const ruangValue =
    antarRuang && entry.spaceKind === 'personal' ? (
      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
        <SpaceTag space={entry.direction === 'in' ? 'bersama' : 'pribadi'} />
        <span aria-hidden="true">→</span>
        <SpaceTag space={entry.direction === 'in' ? 'pribadi' : 'bersama'} />
        <span className="sr-only">
          {entry.direction === 'in' ? 'dari Bersama ke Pribadi' : 'dari Pribadi ke Bersama'}
        </span>
      </span>
    ) : undefined;

  const live = voidedAt === undefined;
  const showActions = editable || voidable || movable || reimbursable !== null;
  const notes = live ? (
    <>
      {antarRuang && voidable ? (
        <ActionNote>Transfer tidak bisa diubah. Batalkan, lalu catat lagi.</ActionNote>
      ) : null}
      {antarRuang && !voidable ? (
        <ActionNote>{`Hanya ${entry.createdBy.name} yang bisa membatalkan transfer ini.`}</ActionNote>
      ) : null}
      {entry.kind === 'expense' && talangan !== null && talangan.items.length > 0 ? (
        <ActionNote>Batalkan reimburse di bawah dulu untuk membatalkan talangan ini.</ActionNote>
      ) : null}
    </>
  ) : null;

  return (
    <EntryDetailView
      entry={entry}
      title={labels.title}
      category={labels.category}
      amount={labels.amount}
      ruang={ruang}
      by={by}
      today={today}
      listHref={listHref}
      banner={banner}
      struck={voidedAt !== undefined}
      {...(moved ? { struckText: 'dipindahkan' } : {})}
      {...(ruangValue === undefined ? {} : { ruangValue })}
      heroNote={
        live && talangan !== null ? (
          <TalanganStatus total={entry.amount} talangan={talangan} />
        ) : null
      }
      rows={entry.reimbursable === true ? <DetailRow term="Talangan">Ya, kantor</DetailRow> : null}
      after={
        <>
          {talangan === null ? null : <ReimbursementList ruang={ruang} talangan={talangan} />}
          {entry.kind === 'reimbursement' && entry.reimbursesEntryId !== undefined ? (
            <Link
              href={buildEntryHref(ruang, entry.reimbursesEntryId, '')}
              className={buttonClass('secondary', 'md', 'self-start')}
            >
              Lihat talangan
            </Link>
          ) : null}
        </>
      }
      actions={
        showActions || notes !== null ? (
          <div className="flex flex-col gap-2">
            {showActions ? (
              <DetailActionsIsland
                ruang={ruang}
                entry={entry}
                accounts={accounts}
                categories={categories}
                today={today}
                me={me}
                listHref={listHref}
                editable={editable}
                voidable={voidable}
                moveTo={movable ? tujuan : null}
                reimbursable={reimbursable}
              />
            ) : null}
            {notes}
          </div>
        ) : null
      }
    />
  );
}

/** Gagal muat (galat loader ditangkap page): salinan tetap + Coba lagi (`router.refresh`). */
export function DetailFailed({ listHref }: { listHref: Route }) {
  return (
    <article className="flex flex-col gap-3 tablet:gap-4 laptop:max-w-180 laptop:pt-6">
      <BackLink href={listHref}>Transaksi</BackLink>
      <ErrorState
        title="Transaksi belum bisa dimuat."
        description="Periksa koneksi lalu coba lagi."
        actions={<RetryIsland />}
      />
    </article>
  );
}
