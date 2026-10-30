'use client';

import { Sheet } from '@/components/ui/sheet';
import { focusRing } from '@/components/ui/styles';
import { useDemo } from './demo-provider';

const MENU_ITEMS = ['Trip', 'Kategori', 'Kontak', 'Export', 'Analisis', 'Pengaturan'];

export function MenuSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { ruang } = useDemo();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Menu" tint={ruang}>
      <ul className="flex flex-col">
        {MENU_ITEMS.map((name) => (
          <li key={name} className="border-b border-hairline last:border-b-0">
            {/* Fokusable tapi tidak berfungsi: fitur ini di luar M0a. */}
            <button
              type="button"
              aria-disabled="true"
              className={`flex min-h-11 w-full items-center justify-between rounded-field px-2 text-left text-base text-text-muted ${focusRing}`}
            >
              {name}
              <span className="rounded-pill bg-surface-2 px-2 text-sm text-text-muted">Segera</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
