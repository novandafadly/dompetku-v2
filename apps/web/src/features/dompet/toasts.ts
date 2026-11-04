import { formatRupiah } from '@dompetku/domain';
import type { Ruang } from '@/features/ledger/types';
import { RUANG_NAME } from './context';

// Salinan toast aksi riwayat dompet (S7-W1/W3), terpisah dari sheet/dialognya supaya pulau klien
// bisa memakainya tanpa ikut memuat sheet/dialog (R28).

/** `+Rp 250.000` / `−Rp 50.000` (tanda selalu ditulis). */
export const signedRupiah = (n: number): string => formatRupiah(n, { sign: 'always' });

/** Toast sukses cocokkan saldo: `Saldo {dompet} dicocokkan di {Ruang} · selisih +{Rp}`. */
export function reconciledToast(name: string, ruang: string, difference: number): string {
  return `Saldo ${name} dicocokkan di ${ruang} · selisih ${signedRupiah(difference)}`;
}

export const archivedWalletToast = (name: string, ruang: Ruang): string =>
  `${name} diarsipkan di ${RUANG_NAME[ruang]}`;
