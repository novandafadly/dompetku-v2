import { CaretRightIcon } from '@/components/ui/icons/caret-right';
import { UsersThreeIcon } from '@/components/ui/icons/users-three';
import { MoneyText } from '@/components/ui/money-text';
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/ui/state';
import { card, focusRing, rowDivider } from '@/components/ui/styles';
import type { Ruang } from '@/features/ledger/types';
import { UTANG_COPY } from '@/features/utang/copy';
import { InitialTile } from '@/features/utang/debt-views';
import type { ContactVM } from '@/features/utang/types';
import { KategoriBackIsland } from './kategori-islands';
import { AddContactIsland, ContactRowIsland, KontakHostIsland } from './kontak-islands';
import { RetryIsland } from './transaksi-islands';
import { KONTAK_TITLE_ID } from './utang-ids';

/**
 * Halaman Kontak mode nyata (Server Component; S11-KT1): daftar kontak aktif urut nama dengan
 * ringkasan sisa per arah dari SQL (hanya yang > 0; tanpa merah dan hijau). Hanya Pribadi: rute
 * Bersama 404. Sheet Tambah/Ubah dan dialog arsip adalah pulau klien (dimuat malas); barisnya
 * tombol 62 px yang membuka sheet Ubah.
 */

const WIDTH = 'flex flex-col gap-3 tablet:gap-4 laptop:max-w-180 laptop:pt-6';
const ROW = `-mx-4 flex w-[calc(100%+2rem)] min-h-15.5 items-center gap-3 px-4 py-2.5 text-left hover-pointer:bg-hover active:bg-hover ${focusRing}`;

function Header({ ruang, action }: { ruang: Ruang; action?: React.ReactNode }) {
  return (
    <>
      <KategoriBackIsland ruang={ruang} />
      <div className="flex flex-col gap-3 laptop:flex-row laptop:items-end laptop:justify-between">
        <h1
          id={KONTAK_TITLE_ID}
          tabIndex={-1}
          className="text-headline font-extrabold text-text outline-none laptop:text-title-lg"
        >
          {`${UTANG_COPY.contactsTitle} · Pribadi`}
        </h1>
        {action}
      </div>
    </>
  );
}

function ContactSummary({ contact }: { contact: ContactVM }) {
  const lines = [
    ...(contact.borrowedRemaining > 0
      ? [{ label: UTANG_COPY.borrowed, value: contact.borrowedRemaining }]
      : []),
    ...(contact.lentRemaining > 0
      ? [{ label: UTANG_COPY.lent, value: contact.lentRemaining }]
      : []),
  ];
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-body/tight font-semibold text-text">
        <span className="sr-only">Ubah kontak </span>
        <span className="line-clamp-2 break-words">{contact.name}</span>
      </span>
      {lines.length === 0 ? (
        <span className="text-meta font-medium text-text-muted">{UTANG_COPY.noActiveDebt}</span>
      ) : (
        lines.map((l) => (
          <span key={l.label} className="text-meta font-medium whitespace-nowrap text-text-muted">
            {`${l.label} `}
            <MoneyText value={l.value} size="inherit" />
          </span>
        ))
      )}
    </span>
  );
}

export function KontakReal({ ruang, contacts }: { ruang: Ruang; contacts: ContactVM[] }) {
  return (
    <KontakHostIsland ruang={ruang} contacts={contacts}>
      <section className={WIDTH}>
        <Header
          ruang={ruang}
          action={
            contacts.length > 0 ? (
              <AddContactIsland variant="secondary" plus className="w-full laptop:w-auto" />
            ) : undefined
          }
        />
        {contacts.length === 0 ? (
          <EmptyState
            tone="accent"
            icon={<UsersThreeIcon size={28} />}
            title={UTANG_COPY.contactEmptyTitle}
            headingLevel={2}
            description={UTANG_COPY.contactEmptyDescription}
            action={<AddContactIsland variant="primary" />}
          />
        ) : (
          <ul className={`${card} px-4`}>
            {contacts.map((c) => (
              <li key={c.contactId} className={rowDivider}>
                <ContactRowIsland contactId={c.contactId} className={ROW}>
                  <InitialTile name={c.name} size={9} />
                  <ContactSummary contact={c} />
                  <CaretRightIcon size={16} className="shrink-0 text-text-muted" />
                </ContactRowIsland>
              </li>
            ))}
          </ul>
        )}
      </section>
    </KontakHostIsland>
  );
}

/** Gagal muat (galat loader ditangkap page): salinan tetap + Coba lagi (`router.refresh`). */
export function KontakFailed({ ruang }: { ruang: Ruang }) {
  return (
    <section className={WIDTH}>
      <Header ruang={ruang} />
      <ErrorState
        title={UTANG_COPY.contactsFailedTitle}
        description={UTANG_COPY.contactsFailedDescription}
        actions={<RetryIsland />}
      />
    </section>
  );
}

/**
 * Kerangka tiga baris selama server memuat (`loading.tsx`). Tanpa judul: ruangnya belum diketahui
 * (Bersama menjawab 404 sesudah gerbang), jadi tidak ada kata Pribadi/Kontak di Bersama.
 */
export function KontakLoading() {
  return (
    <section className={WIDTH}>
      <LoadingRegion label={UTANG_COPY.contactsLoading}>
        <Skeleton className="h-15.5" />
        <Skeleton className="h-15.5" />
        <Skeleton className="h-15.5" />
      </LoadingRegion>
    </section>
  );
}
