'use client';

import { FlaskIcon } from '@/components/ui/icons/flask';
import { ListIcon } from '@/components/ui/icons/list';
import { IconButton } from '@/components/ui/icon-button';
import { useNav } from './nav-provider';
import { RUANG_LABEL } from './hrefs';
import { SpaceSwitcher } from './space-switcher';

/** Penanda prototipe: kecil di bawah nama ruang (HP) atau merek (sidebar). Mode nyata: tidak ada. */
export function DemoMark() {
  return (
    <span className="flex items-center gap-1 text-tag font-semibold text-text-muted">
      <FlaskIcon size={12} className="shrink-0" />
      Data demo
    </span>
  );
}

/** Header HP dan tablet (< 1024): nama ruang aktif, pengalih ruang, Menu. */
export function AppHeader({ onMenu, demo }: { onMenu: () => void; demo: boolean }) {
  const { ruang } = useNav();
  return (
    <header className="sticky top-0 z-20 flex min-h-16.5 items-center gap-2 border-b border-hairline bg-bg py-2 pr-2.5 pl-4 laptop:hidden">
      <div className="flex min-w-0 flex-1 flex-col gap-0.75">
        {/* Di bawah 360 px nama ruang hanya untuk pembaca layar; pengalih sudah menandai ruang aktif. */}
        <span className="truncate text-header/tight font-extrabold tracking-tight max-narrow:sr-only">
          {RUANG_LABEL[ruang]}
        </span>
        {demo ? <DemoMark /> : null}
      </div>
      <SpaceSwitcher />
      <IconButton label="Menu" icon={<ListIcon size={20} />} onClick={onMenu} />
    </header>
  );
}
