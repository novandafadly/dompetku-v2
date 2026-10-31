import type { Icon, IconProps } from './icon';
import { ArrowsLeftRightIcon } from './icons/arrows-left-right';
import { BagIcon } from './icons/bag';
import { BankIcon } from './icons/bank';
import { BowlFoodIcon } from './icons/bowl-food';
import { BriefcaseIcon } from './icons/briefcase';
import { CarSimpleIcon } from './icons/car-simple';
import { CarrotIcon } from './icons/carrot';
import { CoffeeIcon } from './icons/coffee';
import { DeviceMobileIcon } from './icons/device-mobile';
import { FilmSlateIcon } from './icons/film-slate';
import { FirstAidKitIcon } from './icons/first-aid-kit';
import { FlagIcon } from './icons/flag';
import { ForkKnifeIcon } from './icons/fork-knife';
import { GasPumpIcon } from './icons/gas-pump';
import { HandCoinsIcon } from './icons/hand-coins';
import { HouseLineIcon } from './icons/house-line';
import { LightningIcon } from './icons/lightning';
import { MoneyIcon } from './icons/money';
import { ReceiptIcon } from './icons/receipt';
import { RepeatIcon } from './icons/repeat';
import { ShoppingCartIcon } from './icons/shopping-cart';
import { TagIcon } from './icons/tag';
import { UsersThreeIcon } from './icons/users-three';
import { WifiHighIcon } from './icons/wifi-high';

/** Ikon kategori dari handoff (Assets); kunci = nama kategori di data. */
const BY_NAME: Record<string, Icon> = {
  'Makan Siang & Minum': BowlFoodIcon,
  'Kopi & Camilan': CoffeeIcon,
  Transportasi: CarSimpleIcon,
  Belanja: BagIcon,
  Hiburan: FilmSlateIcon,
  Kesehatan: FirstAidKitIcon,
  Langganan: RepeatIcon,
  'Cicilan & Tagihan': ReceiptIcon,
  'Perjalanan Dinas': BriefcaseIcon,
  Gaji: MoneyIcon,
  'Sewa Rumah': HouseLineIcon,
  'Listrik & Air': LightningIcon,
  Internet: WifiHighIcon,
  'Iuran Lingkungan': UsersThreeIcon,
  'Belanja Dapur': ShoppingCartIcon,
  'Sayur & Buah': CarrotIcon,
  'Makan di Luar': ForkKnifeIcon,
  'Bensin & Parkir': GasPumpIcon,
  'Kontribusi Farida': HandCoinsIcon,
};

/** Ikon untuk entri tanpa kategori: saldo awal, transfer, antar ruang. */
const BY_KIND = {
  opening_balance: FlagIcon,
  transfer: ArrowsLeftRightIcon,
  space_transfer: ArrowsLeftRightIcon,
} as const;

export function categoryGlyph(name: string | undefined, kind: string | undefined): Icon {
  return (
    (name === undefined ? undefined : BY_NAME[name]) ??
    (kind !== undefined && kind in BY_KIND ? BY_KIND[kind as keyof typeof BY_KIND] : TagIcon)
  );
}

const WALLET: Record<'bank' | 'cash' | 'ewallet', Icon> = {
  bank: BankIcon,
  cash: MoneyIcon,
  ewallet: DeviceMobileIcon,
};

export function walletGlyph(type: 'bank' | 'cash' | 'ewallet'): Icon {
  return WALLET[type];
}

export function renderCategoryIcon(
  name: string | undefined,
  kind: string | undefined,
  props: IconProps,
) {
  const Glyph = categoryGlyph(name, kind);
  return <Glyph {...props} />;
}

export function renderWalletIcon(type: 'bank' | 'cash' | 'ewallet', props: IconProps) {
  const Glyph = walletGlyph(type);
  return <Glyph {...props} />;
}
