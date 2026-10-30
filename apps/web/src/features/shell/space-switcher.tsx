'use client';

import { usePathname, useRouter } from 'next/navigation';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useDemo } from './demo-provider';
import { isRuang, RUANG_LABEL, tabFromPathname } from './hrefs';

const ITEMS = [
  { value: 'pribadi', label: RUANG_LABEL.pribadi },
  { value: 'bersama', label: RUANG_LABEL.bersama },
];

export function SpaceSwitcher() {
  const { ruang, href } = useDemo();
  const router = useRouter();
  const tab = tabFromPathname(usePathname());
  return (
    <SegmentedControl
      label="Ruang"
      items={ITEMS}
      value={ruang}
      onChange={(v) => {
        if (isRuang(v)) router.push(href(v, tab));
      }}
    />
  );
}
