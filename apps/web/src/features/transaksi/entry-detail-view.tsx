import { detailDateLabel, formatRupiah, type IsoDate, type Rupiah } from '@dompetku/domain';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { CategoryIcon } from '@/components/ui/category-icon';
import { MoneyText, type MoneyKind } from '@/components/ui/money-text';
import { SpaceTag } from '@/components/ui/space-tag';
import { card, heroCard, rowDivider, tile } from '@/components/ui/styles';
import type { EntryVM, Ruang } from '@/features/ledger/types';

const KIND_NAME: Record<EntryVM['kind'], string> = {
  expense: 'Pengeluaran',
  income: 'Pemasukan',
  transfer: 'Pindah dompet',
  opening_balance: 'Saldo awal',
  space_transfer: 'Antar ruang',
  adjustment: 'Cocokkan saldo',
  reimbursement: 'Reimburse',
};

/** Dompet entri: transfer satu ruang = "BCA → Tunai". */
export function entryWalletVM(e: EntryVM): string {
  return e.kind === 'transfer' && e.counterAccountName !== undefined
    ? `${e.accountName} → ${e.counterAccountName}`
    : e.accountName;
}

export function DetailRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className={`flex min-h-13 items-center justify-between gap-3 ${rowDivider}`}>
      <dt className="text-body font-medium text-text-muted">{term}</dt>
      <dd className="min-w-0 text-right text-body font-semibold break-words text-text">
        {children}
      </dd>
    </div>
  );
}

/**
 * Ukuran nominal Detail: 40 px (handoff D1) selama muat; nominal panjang mengecil di HP agar 320 px
 * tanpa gulir horizontal (`Rp 12.345.678.900`). Lebar kartu 320 = 254 px; 40 px ≈ 21,4 px per
 * karakter. Sampai 11 karakter tidak berubah (`null` = ukuran `amount` MoneyText).
 */
function amountClass(length: number): string | null {
  if (length <= 11) return null;
  if (length <= 13) return 'text-amount-sm font-extrabold narrow:text-amount';
  if (length === 14) return 'text-title-lg font-extrabold narrow:text-amount-sm tablet:text-amount';
  return 'text-title font-extrabold tablet:text-amount';
}

/** Id judul Detail: sesudah Pulihkan, fokus pindah ke judul (S6-D3). */
export const DETAIL_TITLE_ID = 'detail-transaksi-judul';

/**
 * Detail transaksi dari `EntryVM`, untuk kedua mode: mode nyata merendernya di server (aksi = pulau
 * klien), pembungkus demo (`EntryDetail`) memetakan entri demo ke VM lebih dulu. Markup sama
 * dengan Detail M0a; yang berbeda per mode diisi lewat slot.
 *
 * Judul, label kategori, dan nominal bertanda dihitung pemanggil (nyata: `features/ledger/present`
 * di server; demo: selector demo yang sudah dimuat rute). View ini sengaja tidak mengimpor
 * `present.ts`: modul yang dipakai dua rute tidak lagi disatukan ke chunk page Transaksi dan itu
 * menambah JS muat awal Transaksi prototipe (ADR 0002).
 */
export function EntryDetailView({
  entry,
  title,
  category,
  amount,
  ruang,
  by,
  today,
  listHref,
  banner,
  heroNote,
  actions,
  struck = false,
  struckText = 'dibatalkan',
  ruangValue,
  rows,
  after,
}: {
  entry: EntryVM;
  /** Judul (deskripsi, catatan bersama, atau kategori). */
  title: string;
  /** Baris Kategori: nama kategori atau jenis (Saldo awal, Pindah dompet, …). */
  category: string;
  /** Nominal bertanda dari sudut pandang ruang entri. */
  amount: { value: Rupiah; kind: MoneyKind };
  ruang: Ruang;
  /** "Dicatat oleh": `kamu` atau nama anggota. */
  by: string;
  today: IsoDate;
  listHref: Route;
  /** Di atas kartu atas (S6-D3: banner entri batal). */
  banner?: ReactNode;
  /** Di dalam kartu atas, di bawah nominal (prototipe: penanda batal M0a). */
  heroNote?: ReactNode;
  /** Tombol aksi di bawah rincian. */
  actions?: ReactNode;
  /** Nominal dicoret + teks pembaca layar `dibatalkan` (S6-D3). */
  struck?: boolean;
  /** Teks pembaca layar di nominal yang dicoret (`dipindahkan` untuk entri asal Pindahkan, S7-D2). */
  struckText?: string;
  /** Isi baris Ruang bila bukan satu `SpaceTag` (antar ruang Pribadi: `Pribadi → Bersama`, S7-D1). */
  ruangValue?: ReactNode;
  /** Baris rincian tambahan sesudah Dicatat oleh (mis. `Talangan`, S7-D3). */
  rows?: ReactNode;
  /** Di bawah rincian, di atas aksi (mis. daftar reimburse, S7-D3). */
  after?: ReactNode;
}) {
  const { value, kind } = amount;
  const sizeClass = amountClass(
    formatRupiah(value, kind === 'income' ? { sign: 'always' } : {}).length,
  );
  return (
    <article className="flex flex-col gap-3 tablet:gap-4 laptop:max-w-180 laptop:pt-6">
      <BackLink href={listHref}>Transaksi</BackLink>
      {banner}
      <section className={`flex flex-col gap-3 p-4 ${heroCard}`}>
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className={`size-12 ${tile}`}>
            <CategoryIcon name={entry.categoryName} kind={entry.kind} size={24} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1
              id={DETAIL_TITLE_ID}
              className="text-subheading font-bold break-words text-text outline-none"
            >
              {title}
            </h1>
            <p className="text-label font-medium text-text-muted">{KIND_NAME[entry.kind]}</p>
          </div>
        </div>
        <p>
          <MoneyText
            value={value}
            kind={kind}
            size={sizeClass === null ? 'amount' : 'inherit'}
            className={[sizeClass, struck ? 'text-text-muted! line-through' : null]
              .filter((c) => c !== null)
              .join(' ')}
          />
          {struck ? <span className="sr-only"> {struckText}</span> : null}
        </p>
        {heroNote}
      </section>
      <dl className={`px-4 ${card}`}>
        <DetailRow term="Kategori">{category}</DetailRow>
        <DetailRow term="Dompet">{entryWalletVM(entry)}</DetailRow>
        <DetailRow term="Tanggal">{detailDateLabel(entry.occurredOn, today)}</DetailRow>
        <DetailRow term="Ruang">{ruangValue ?? <SpaceTag space={ruang} />}</DetailRow>
        <DetailRow term="Dicatat oleh">{by}</DetailRow>
        {(() => {
          const personalNote = entry.kind === 'space_transfer' ? entry.description : undefined;
          const sharedNote = entry.sharedNote;
          if (personalNote !== undefined && sharedNote !== undefined && personalNote !== sharedNote) {
            return (
              <>
                <DetailRow term="Catatan pribadi">{personalNote}</DetailRow>
                <DetailRow term="Catatan Bersama">{sharedNote}</DetailRow>
              </>
            );
          }
          const singleNote = personalNote ?? sharedNote;
          return singleNote === undefined ? null : (
            <DetailRow term="Catatan">{singleNote}</DetailRow>
          );
        })()}
        {rows}
      </dl>
      {after}
      {actions}
    </article>
  );
}
