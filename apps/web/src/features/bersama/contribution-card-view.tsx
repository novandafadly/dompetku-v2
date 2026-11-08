import { HandCoinsIcon } from '@/components/ui/icons/hand-coins';
import { EmptyLine, ListCard } from '@/components/ui/list-card';
import { MoneyText } from '@/components/ui/money-text';
import { CardError } from './card-error';
import { MemberAvatar } from './member-avatar';
import type { ContributionVM } from './types';

/**
 * Kartu Kontribusi Beranda Bersama dua anggota (S8-K1, K2). Server Component tanpa JS klien dan
 * tanpa modul demo; hanya `ContributionVM`. Tanpa persentase, peringkat, bilah, atau warna
 * menang/kalah; angka nol netral. Tidak ada id yang tampil di DOM; key React membawa id anggota
 * (user id anggota ruang ini) ke payload RSC, tanpa id akun, tautan, atau ruang lain.
 */
export function ContributionCardView({ vm }: { vm: ContributionVM }) {
  return (
    <ListCard
      title={`Kontribusi ${vm.period.label}`}
      icon={<HandCoinsIcon size={18} />}
      note={
        <p className="text-meta font-medium text-text-muted">
          Setoran dan pengambilan antar ruang bulan ini.
        </p>
      }
    >
      {vm.allZero ? (
        <EmptyLine>Belum ada setoran atau pengambilan bulan ini.</EmptyLine>
      ) : (
        <ul className="pt-1">
          {vm.rows.map((r) => (
            <li
              key={r.member.id}
              className="flex flex-col gap-1.5 border-t border-hairline py-3 first:border-t-0"
            >
              <div className="flex items-center gap-3">
                <MemberAvatar role={r.member.role} initial={r.member.initial} />
                <span className="min-w-0 flex-1 text-body font-bold break-words text-text">
                  {r.member.name}
                </span>
              </div>
              <dl className="flex max-w-52 flex-col gap-0.5 pl-12">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-meta font-medium text-text-soft">Setor</dt>
                  <dd
                    className={`text-body font-extrabold whitespace-nowrap ${r.setoran === 0 ? 'text-text-muted' : 'text-text'}`}
                  >
                    <MoneyText value={r.setoran} size="inherit" />
                  </dd>
                </div>
                {r.diambil > 0 ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-meta font-medium text-text-soft">Diambil</dt>
                    <dd className="text-meta font-medium whitespace-nowrap text-text-soft">
                      <MoneyText value={r.diambil} size="inherit" />
                    </dd>
                  </div>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </ListCard>
  );
}

/** Kartu Kontribusi yang bacaannya gagal: kartu lain di Beranda tetap tampil. */
export function ContributionCardError({ retryHref }: { retryHref: string }) {
  return (
    <ListCard title="Kontribusi" icon={<HandCoinsIcon size={18} />}>
      <CardError message="Kontribusi belum bisa dimuat." retryHref={retryHref} />
    </ListCard>
  );
}
