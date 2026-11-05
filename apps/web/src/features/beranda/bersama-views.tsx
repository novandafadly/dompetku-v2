import { weekdayDateLabel, type IsoDate } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import { buttonClass } from '@/components/ui/button';
import { ClockIcon } from '@/components/ui/icons/clock';
import { UserPlusIcon } from '@/components/ui/icons/user-plus';
import { UsersThreeIcon } from '@/components/ui/icons/users-three';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { EmptyLine, ListCard } from '@/components/ui/list-card';
import { EmptyState } from '@/components/ui/state';
import { card } from '@/components/ui/styles';

/**
 * Tampilan Beranda Bersama untuk keadaan awal (S7-B1 satu anggota, S7-B2 kosong). Tanpa JS klien:
 * dirender di Server Component dan hanya menerima props tampilan (ADR 0002, budget 162 kB).
 */

/** Pengantar checklist Bersama yang baru berisi satu orang (S7-B1). */
export const BERSAMA_SOLO_INTRO = 'Ruang untuk keuangan bersama.';

/**
 * Kartu ajakan (S7-B1), hanya untuk pemilik. `pending` = undangan sudah terkirim dan menunggu;
 * `null` = belum ada undangan.
 */
export function BersamaInviteCard({
  href,
  pending,
}: {
  href: Route;
  pending: { email: string; expiresOn: IsoDate } | null;
}) {
  return (
    <section
      aria-labelledby="ajak-bersama"
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 ${card}`}
    >
      {pending ? (
        <ClockIcon size={18} className="shrink-0 text-text-soft" />
      ) : (
        <UserPlusIcon size={20} className="shrink-0 text-accent-text" />
      )}
      <p
        id="ajak-bersama"
        className={`min-w-0 flex-1 basis-40 break-words ${
          pending ? 'text-label font-medium text-text-soft' : 'text-body font-semibold text-text'
        }`}
      >
        {pending
          ? `Undangan untuk ${pending.email} menunggu, berlaku sampai ${weekdayDateLabel(pending.expiresOn)}.`
          : 'Farida belum bergabung di Bersama.'}
      </p>
      <Link
        href={href}
        aria-label={pending ? undefined : 'Undang Farida ke Bersama'}
        className={buttonClass('secondary', 'md', 'shrink-0')}
      >
        {pending ? 'Kelola undangan' : 'Undang Farida'}
      </Link>
    </section>
  );
}

/** Kartu Aktivitas kosong (S7-B1): tidak ada aktor, jadi tidak ada avatar atau nama. */
export function BersamaAktivitasKosong() {
  return (
    <ListCard title="Aktivitas" icon={<UsersThreeIcon size={18} />}>
      <EmptyLine>
        Belum ada aktivitas. Yang dicatat di Bersama akan muncul di sini, terbaru di atas.
      </EmptyLine>
    </ListCard>
  );
}

/** Kartu utama pengganti Aman dipakai bila Bersama tanpa dompet operasional dan tanpa entri (S7-B2). */
export function BersamaKosongCard({ addWalletHref }: { addWalletHref: Route }) {
  return (
    <EmptyState
      tone="accent"
      headingLevel={2}
      icon={<WalletIcon size={24} />}
      title="Bersama belum punya dompet."
      description="Buat dompet bersama dulu, lalu catat pengeluaran bersama di sini."
      action={
        <Link href={addWalletHref} className={buttonClass('primary', 'md', 'w-full')}>
          Tambah dompet
        </Link>
      }
    />
  );
}
