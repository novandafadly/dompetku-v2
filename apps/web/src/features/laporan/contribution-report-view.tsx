import { MoneyText } from '@/components/ui/money-text';
import { card } from '@/components/ui/styles';
import type { Rupiah } from '@dompetku/domain';

/** Bentuk struktural `ContributionVM` Bersama (fitur lain tidak diimpor; dirakit di `_real`). */
export interface ReportContributionVM {
  rows: {
    member: { id: string; name: string; initial: string; role: 'owner' | 'member' | null };
    setoran: Rupiah;
    diambil: Rupiah;
  }[];
}

/**
 * Kontribusi per orang di Laporan Bersama (S9-LP3, K10): setoran dan pengambilan antar ruang pada
 * periode yang dilihat. Tanpa peringkat, persen, bilah, atau warna menang/kalah. Beda sengaja
 * dengan kartu Beranda S8 untuk keadaan nol (`Belum ada setoran`, bukan `Setor Rp 0`).
 */
export function ContributionReportView({
  vm,
  labelledBy,
}: {
  vm: ReportContributionVM;
  labelledBy: string;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      data-testid="laporan-kontribusi"
      className={`flex flex-col px-4 py-3.5 ${card}`}
    >
      <h2 id={labelledBy} className="text-label font-bold text-text-soft">
        Kontribusi per orang
      </h2>
      <p className="text-meta font-medium text-text-muted">
        Setoran dan pengambilan antar ruang periode ini.
      </p>
      <ul className="mt-1">
        {vm.rows.map((r) => (
          <li
            key={r.member.id}
            className="flex min-h-15 items-center gap-3 border-t border-hairline py-2 first:mt-1"
          >
            <span
              aria-hidden="true"
              className={`flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-label font-extrabold ${
                r.member.role === 'member'
                  ? 'bg-bersama-tint text-bersama'
                  : 'bg-surface-3 text-text'
              }`}
            >
              {r.member.initial}
            </span>
            <span className="min-w-0 flex-1 text-body font-semibold break-words text-text">
              {r.member.name}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              {r.setoran > 0 ? (
                <span className="text-body font-bold whitespace-nowrap text-text">
                  Setor <MoneyText value={r.setoran} size="inherit" />
                </span>
              ) : (
                <span className="text-label font-medium text-text-muted">Belum ada setoran</span>
              )}
              {r.diambil > 0 ? (
                <span className="text-meta font-medium whitespace-nowrap text-text-muted">
                  Diambil <MoneyText value={r.diambil} size="inherit" />
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
