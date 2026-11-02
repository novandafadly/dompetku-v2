import { RUANG_LABEL } from '@/features/shell/hrefs';
import { PageHeader } from '@/features/shell/page-header';
import { card } from '@/components/ui/styles';
import type { Ruang } from '@/features/ledger/types';

/**
 * Pengganti sementara halaman mode nyata yang belum tersambung ke ledger (Transaksi Task 15,
 * Dompet Task 18). Dirender server, tanpa data demo dan tanpa data ledger. Diganti task itu.
 */
export function RealPlaceholder({ ruang, title }: { ruang: Ruang; title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <section aria-labelledby="segera" className={`flex flex-col gap-1.5 p-4 ${card}`}>
        <h2 id="segera" className="text-body font-bold text-text">
          {`${title} ${RUANG_LABEL[ruang]} belum tersedia`}
        </h2>
        <p className="text-label font-medium text-text-soft">
          Halaman ini sedang disambungkan ke data. Catat tetap bisa dipakai dari tombol Catat.
        </p>
      </section>
    </>
  );
}
