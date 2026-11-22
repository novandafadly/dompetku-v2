import { BankIcon } from '@/components/ui/icons/bank';
import { CarSimpleIcon } from '@/components/ui/icons/car-simple';
import { ChartBarIcon } from '@/components/ui/icons/chart-bar';
import { ChartLineUpIcon } from '@/components/ui/icons/chart-line-up';
import { CoinsIcon } from '@/components/ui/icons/coins';
import { DotsThreeCircleIcon } from '@/components/ui/icons/dots-three-circle';
import { HouseLineIcon } from '@/components/ui/icons/house-line';
import type { Icon } from '@/components/ui/icon';
import type { AssetKind } from '@/features/ledger/types';

const BY_KIND: Record<AssetKind, Icon> = {
  emas: CoinsIcon,
  properti: HouseLineIcon,
  kendaraan: CarSimpleIcon,
  reksa_dana: ChartBarIcon,
  deposito: BankIcon,
  saham: ChartLineUpIcon,
  lainnya: DotsThreeCircleIcon,
};

/** Ikon jenis aset (S14-AS1); satu ikon baru `coins` untuk emas. */
export function AssetKindIcon({ kind, size = 20 }: { kind: AssetKind; size?: number }) {
  const Glyph = BY_KIND[kind];
  return <Glyph size={size} />;
}
