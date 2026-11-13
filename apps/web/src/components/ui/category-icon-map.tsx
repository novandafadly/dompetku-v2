import type { Icon, IconProps } from './icon';
import { AirplaneTiltIcon } from './icons/airplane-tilt';
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

/** Ikon untuk entri tanpa kategori: saldo awal, transfer, antar ruang, pokok/cicilan utang. */
const BY_KIND = {
  opening_balance: FlagIcon,
  transfer: ArrowsLeftRightIcon,
  space_transfer: ArrowsLeftRightIcon,
  debt_principal: HandCoinsIcon,
  debt_payment: HandCoinsIcon,
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

/**
 * Pilihan ikon kategori (Menu → Kategori). `name` = nilai yang disimpan di kolom `icon` (nama
 * Phosphor, `^[A-Z][A-Za-z0-9]{0,39}$`); `label` = nama untuk pembaca layar.
 */
export const ICON_CHOICES: readonly { name: string; label: string; Glyph: Icon }[] = [
  { name: 'Tag', label: 'Label', Glyph: TagIcon },
  { name: 'BowlFood', label: 'Makanan', Glyph: BowlFoodIcon },
  { name: 'ForkKnife', label: 'Restoran', Glyph: ForkKnifeIcon },
  { name: 'Coffee', label: 'Kopi', Glyph: CoffeeIcon },
  { name: 'CarSimple', label: 'Kendaraan', Glyph: CarSimpleIcon },
  { name: 'GasPump', label: 'Bensin', Glyph: GasPumpIcon },
  { name: 'Bag', label: 'Belanja', Glyph: BagIcon },
  { name: 'ShoppingCart', label: 'Keranjang', Glyph: ShoppingCartIcon },
  { name: 'Carrot', label: 'Sayur', Glyph: CarrotIcon },
  { name: 'FilmSlate', label: 'Hiburan', Glyph: FilmSlateIcon },
  { name: 'FirstAidKit', label: 'Kesehatan', Glyph: FirstAidKitIcon },
  { name: 'Repeat', label: 'Langganan', Glyph: RepeatIcon },
  { name: 'Receipt', label: 'Tagihan', Glyph: ReceiptIcon },
  { name: 'Briefcase', label: 'Kerja', Glyph: BriefcaseIcon },
  { name: 'Money', label: 'Uang', Glyph: MoneyIcon },
  { name: 'HandCoins', label: 'Setoran', Glyph: HandCoinsIcon },
  { name: 'HouseLine', label: 'Rumah', Glyph: HouseLineIcon },
  { name: 'Lightning', label: 'Listrik', Glyph: LightningIcon },
  { name: 'WifiHigh', label: 'Internet', Glyph: WifiHighIcon },
  { name: 'UsersThree', label: 'Kelompok', Glyph: UsersThreeIcon },
  { name: 'AirplaneTilt', label: 'Perjalanan', Glyph: AirplaneTiltIcon },
  { name: 'DeviceMobile', label: 'Ponsel', Glyph: DeviceMobileIcon },
];

/** Ikon kategori awal ruang yang namanya Phosphor lain dari pilihan di atas → pilihan terdekat. */
const ICON_ALIAS: Record<string, string> = {
  Motorcycle: 'CarSimple',
  ShoppingBag: 'Bag',
  Heartbeat: 'FirstAidKit',
  House: 'HouseLine',
};

/**
 * Nama pilihan untuk kategori: nilai `icon` tersimpan lebih dulu (alias dipetakan), lalu glyph dari
 * peta nama kategori (kategori awal ruang), selain itu null → ikon Label.
 */
export function iconChoiceName(icon: string, categoryName?: string): string | null {
  const name = ICON_ALIAS[icon] ?? icon;
  if (ICON_CHOICES.some((c) => c.name === name)) return name;
  const byName = categoryName === undefined ? undefined : BY_NAME[categoryName];
  return ICON_CHOICES.find((c) => c.Glyph === byName)?.name ?? null;
}

/** Ikon dari kolom `icon` kategori (cadangan: nama kategori, lalu Label), untuk daftar Kategori. */
export function renderIconByName(icon: string, categoryName: string | undefined, props: IconProps) {
  const name = iconChoiceName(icon, categoryName);
  const Glyph = ICON_CHOICES.find((c) => c.name === name)?.Glyph ?? TagIcon;
  return <Glyph {...props} />;
}
