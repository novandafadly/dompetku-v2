'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useId, useState } from 'react';
import type { Icon } from '@/components/ui/icon';
import { AddressBookIcon } from '@/components/ui/icons/address-book';
import { AirplaneTiltIcon } from '@/components/ui/icons/airplane-tilt';
import { ChartLineUpIcon } from '@/components/ui/icons/chart-line-up';
import { ExportIcon } from '@/components/ui/icons/export';
import { GearSixIcon } from '@/components/ui/icons/gear-six';
import { CaretRightIcon } from '@/components/ui/icons/caret-right';
import { HourglassMediumIcon } from '@/components/ui/icons/hourglass-medium';
import { TagIcon } from '@/components/ui/icons/tag';
import { TrashIcon } from '@/components/ui/icons/trash';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet } from '@/components/ui/sheet';
import { focusRing, rowDivider, tile } from '@/components/ui/styles';
import { useNav } from './nav-provider';
import { applyTheme, currentTheme, isThemeChoice, type ThemeChoice } from './theme';

const MENU_ITEMS: { name: string; Icon: Icon }[] = [
  { name: 'Trip', Icon: AirplaneTiltIcon },
  { name: 'Kategori', Icon: TagIcon },
  { name: 'Kontak', Icon: AddressBookIcon },
  { name: 'Export', Icon: ExportIcon },
  { name: 'Analisis', Icon: ChartLineUpIcon },
  { name: 'Pengaturan', Icon: GearSixIcon },
];

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'dark', label: 'Gelap' },
  { value: 'light', label: 'Terang' },
  { value: 'system', label: 'Ikuti sistem' },
];

function MenuLink({
  href,
  name,
  Icon,
  onOpenChange,
}: {
  href: Route;
  name: string;
  Icon: Icon;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      onClick={() => {
        onOpenChange(false);
      }}
      className={`flex min-h-13 w-full items-center gap-3 rounded-lg text-left text-body font-semibold text-text hover-pointer:bg-hover ${focusRing}`}
    >
      <span aria-hidden="true" className={`size-9 ${tile}`}>
        <Icon size={18} />
      </span>
      <span className="flex-1">{name}</span>
      <CaretRightIcon size={16} weight="bold" className="shrink-0 text-text-muted" />
    </Link>
  );
}

export function MenuSheet({
  open,
  onOpenChange,
  real = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Mode nyata: Kategori aktif (tautan ke /{ruang}/kategori). Prototipe: tetap "Segera". */
  real?: boolean;
}) {
  const [theme, setTheme] = useState<ThemeChoice>(currentTheme);
  const themeLabel = useId();
  const { ruang, sampahHref, kategoriHref } = useNav();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Menu">
      <ul className="flex flex-col">
        <li className={rowDivider}>
          {/* Aktif di kedua mode: /{ruang}/sampah. */}
          <MenuLink
            href={sampahHref(ruang)}
            name="Sampah"
            Icon={TrashIcon}
            onOpenChange={onOpenChange}
          />
        </li>
        {MENU_ITEMS.map(({ name, Icon }) => (
          <li key={name} className={rowDivider}>
            {real && name === 'Kategori' ? (
              <MenuLink
                href={kategoriHref(ruang)}
                name={name}
                Icon={Icon}
                onOpenChange={onOpenChange}
              />
            ) : (
              /* TODO(M1+): fitur ini di luar M0a; tetap fokusable dan berlabel "Segera". */
              <button
                type="button"
                aria-disabled="true"
                className={`flex min-h-13 w-full items-center gap-3 rounded-lg text-left text-body font-semibold text-text ${focusRing}`}
              >
                <span aria-hidden="true" className={`size-9 ${tile}`}>
                  <Icon size={18} />
                </span>
                <span className="flex-1">{name}</span>
                <span className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-caption font-semibold text-text-soft">
                  <HourglassMediumIcon size={14} className="shrink-0" />
                  Segera
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1.5 pt-1">
        <span id={themeLabel} className="text-meta font-bold text-text">
          Tampilan
        </span>
        <SegmentedControl
          labelledBy={themeLabel}
          items={THEMES}
          value={theme}
          onChange={(v) => {
            if (!isThemeChoice(v)) return;
            setTheme(v);
            applyTheme(v);
          }}
        />
      </div>
    </Sheet>
  );
}
